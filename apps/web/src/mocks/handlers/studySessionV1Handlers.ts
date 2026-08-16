import { errorStatusByCode } from '@nihongo/contracts/common/error'
import {
  createStudySessionBodySchema,
  createStudySessionErrorSchema,
  createStudySessionResponseSchema,
  type CreateStudySessionError
} from '@nihongo/contracts/study/create-study-session'
import {
  getStudySessionErrorSchema,
  getStudySessionParamsSchema,
  getStudySessionResponseSchema,
  type GetStudySessionError
} from '@nihongo/contracts/study/get-study-session'
import {
  getStudyResultErrorSchema,
  getStudyResultParamsSchema,
  getStudyResultResponseSchema,
  type GetStudyResultError
} from '@nihongo/contracts/study/get-study-result'
import {
  duplicateAnswerValidationMarker,
  submitStudySessionBodySchema,
  submitStudySessionErrorSchema,
  submitStudySessionHeadersSchema,
  submitStudySessionParamsSchema,
  submitStudySessionResponseSchema,
  type ParsedSubmitStudySessionBody,
  type SubmitStudySessionError
} from '@nihongo/contracts/study/submit-study-session'
import { http, HttpResponse } from 'msw'
import {
  MockCanonicalSubmissionIntegrityError,
  MockCanonicalSubmissionValidationError,
  mockCanonicalSubmissionOperations
} from '@mocks/adapters/studySubmissionContractAdapter'
import { toContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
import {
  createMockGuestPrincipalCookie,
  inspectMockGuestProof
} from '@mocks/guestPrincipal'
import { MockHttpError, parseJsonBody } from '@mocks/handlers/shared'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'

const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;|$)/iu
const MAX_JSON_BODY_BYTES = 16 * 1_024

const getHeaders = (
  requestId: string,
  code?: string
): Record<string, string> => ({
  'Cache-Control': 'private, no-store',
  'X-Request-Id': requestId,
  ...(code === 'RATE_LIMITED'
    ? { 'Retry-After': '30' }
    : code === 'SERVICE_UNAVAILABLE'
      ? { 'Retry-After': '5' }
      : {})
})

const createCreateErrorResponse = (
  error: CreateStudySessionError
): HttpResponse<CreateStudySessionError> => {
  const payload = createStudySessionErrorSchema.parse(error)

  return HttpResponse.json(payload, {
    status: errorStatusByCode[payload.code],
    headers: getHeaders(payload.requestId, payload.code)
  })
}

const createGetErrorResponse = (
  error: GetStudySessionError
): HttpResponse<GetStudySessionError> => {
  const payload = getStudySessionErrorSchema.parse(error)

  return HttpResponse.json(payload, {
    status: errorStatusByCode[payload.code],
    headers: getHeaders(payload.requestId, payload.code)
  })
}

const createSubmitErrorResponse = (
  error: SubmitStudySessionError,
  location?: string
): HttpResponse<SubmitStudySessionError> => {
  const payload = submitStudySessionErrorSchema.parse(error)

  return HttpResponse.json(payload, {
    status: errorStatusByCode[payload.code],
    headers: {
      ...getHeaders(payload.requestId, payload.code),
      ...(payload.code === 'SESSION_ALREADY_SUBMITTED' && location
        ? { Location: location }
        : {})
    }
  })
}

const createResultErrorResponse = (
  error: GetStudyResultError
): HttpResponse<GetStudyResultError> => {
  const payload = getStudyResultErrorSchema.parse(error)

  return HttpResponse.json(payload, {
    status: errorStatusByCode[payload.code],
    headers: getHeaders(payload.requestId, payload.code)
  })
}

const normalizeCreateError = (
  error: unknown,
  requestId: string
): CreateStudySessionError => {
  if (error instanceof MockHttpError) {
    if (error.code === 'INVALID_JSON') {
      return {
        code: 'INVALID_JSON',
        message: error.message,
        requestId,
        retryable: false
      }
    }
    if (error.code === 'VALIDATION_ERROR') {
      return {
        code: 'VALIDATION_ERROR',
        message: error.message,
        requestId,
        retryable: false
      }
    }
  }

  if (error instanceof MockDatabaseError) {
    if (error.code === 'NOT_FOUND') {
      return {
        code: 'NO_ELIGIBLE_QUESTIONS',
        message: '선택한 조건에 출제 가능한 문제가 없습니다.',
        requestId,
        retryable: false
      }
    }
    if (error.code === 'AUTH_REQUIRED') {
      return {
        code: 'AUTHENTICATION_REQUIRED',
        message: '로그인이 필요합니다.',
        requestId,
        retryable: false
      }
    }
  }

  console.error('Mock v1 createStudySession failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '학습 세션을 만들지 못했습니다.',
    requestId,
    retryable: true
  }
}

const normalizeGetError = (
  error: unknown,
  requestId: string
): GetStudySessionError => {
  if (error instanceof MockDatabaseError) {
    if (error.code === 'AUTH_REQUIRED') {
      return {
        code: 'AUTHENTICATION_REQUIRED',
        message: '학습 세션을 조회하려면 인증 정보가 필요합니다.',
        requestId,
        retryable: false
      }
    }
    if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') {
      return {
        code: 'RESOURCE_NOT_FOUND',
        message: '학습 세션을 찾을 수 없습니다.',
        requestId,
        retryable: false
      }
    }
  }

  console.error('Mock v1 getStudySession failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '학습 세션을 불러오지 못했습니다.',
    requestId,
    retryable: true
  }
}

const parseCanonicalSubmitBody = async (
  request: Request
): Promise<ParsedSubmitStudySessionBody> => {
  let body: unknown
  try {
    const text = await request.text()
    if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
      throw new MockHttpError(
        400,
        'INVALID_REQUEST',
        '요청 본문이 너무 큽니다.'
      )
    }
    const parsedJson: unknown = JSON.parse(text)
    if (
      typeof parsedJson !== 'object' ||
      parsedJson === null ||
      Array.isArray(parsedJson)
    ) {
      throw new MockHttpError(
        400,
        'INVALID_JSON',
        '요청 본문이 올바르지 않습니다.'
      )
    }
    body = parsedJson
  } catch (error: unknown) {
    if (error instanceof MockHttpError) {
      throw error
    }
    throw new MockHttpError(
      400,
      'INVALID_JSON',
      '요청 본문이 올바르지 않습니다.'
    )
  }

  const parsed = submitStudySessionBodySchema.safeParse(body)
  if (parsed.success) {
    return parsed.data
  }

  const isDuplicate = parsed.error.issues.some(
    (issue) =>
      issue.code === 'custom' &&
      issue.params?.contractCode === duplicateAnswerValidationMarker
  )
  const hasInvalidDuration = parsed.error.issues.some((issue) =>
    issue.path.some(
      (segment) => segment === 'durationSec' || segment === 'elapsedSec'
    )
  )
  throw new MockHttpError(
    422,
    isDuplicate
      ? 'DUPLICATE_ANSWER'
      : hasInvalidDuration
        ? 'INVALID_DURATION'
        : 'VALIDATION_ERROR',
    isDuplicate
      ? '같은 세션 문제의 답안을 중복 제출할 수 없습니다.'
      : hasInvalidDuration
        ? '답안 풀이 시간이 허용 범위를 벗어났습니다.'
        : '학습 제출 내용이 올바르지 않습니다.'
  )
}

const normalizeSubmitError = (
  error: unknown,
  requestId: string
): SubmitStudySessionError => {
  if (error instanceof MockHttpError) {
    if (error.code === 'INVALID_REQUEST') {
      return {
        code: 'INVALID_REQUEST',
        message: error.message,
        requestId,
        retryable: false
      }
    }
    if (error.code === 'INVALID_JSON') {
      return {
        code: 'INVALID_JSON',
        message: error.message,
        requestId,
        retryable: false
      }
    }
    if (error.code === 'DUPLICATE_ANSWER') {
      return {
        code: 'DUPLICATE_ANSWER',
        message: error.message,
        requestId,
        retryable: false
      }
    }
    if (error.code === 'INVALID_DURATION') {
      return {
        code: 'INVALID_DURATION',
        message: error.message,
        requestId,
        retryable: false
      }
    }
    if (error.code === 'VALIDATION_ERROR') {
      return {
        code: 'VALIDATION_ERROR',
        message: error.message,
        requestId,
        retryable: false
      }
    }
  }
  if (error instanceof MockCanonicalSubmissionValidationError) {
    return {
      code: error.code,
      message: error.message,
      requestId,
      retryable: false
    }
  }
  if (error instanceof MockDatabaseError) {
    const codeByDatabaseError = {
      AUTH_REQUIRED: 'AUTHENTICATION_REQUIRED',
      FORBIDDEN: 'RESOURCE_NOT_FOUND',
      IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
      NOT_FOUND: 'RESOURCE_NOT_FOUND',
      SESSION_SUBMITTED: 'SESSION_ALREADY_SUBMITTED',
      STUDY_SESSION_NOT_EDITABLE: 'STUDY_SESSION_NOT_EDITABLE'
    } as const
    if (error.code in codeByDatabaseError) {
      const code =
        codeByDatabaseError[error.code as keyof typeof codeByDatabaseError]
      return {
        code,
        message:
          code === 'RESOURCE_NOT_FOUND'
            ? '학습 세션을 찾을 수 없습니다.'
            : error.message,
        requestId,
        retryable: false
      }
    }
  }

  if (!(error instanceof MockCanonicalSubmissionIntegrityError)) {
    console.error('Mock v1 submitStudySession failed', error)
  }
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '학습 제출을 처리하지 못했습니다.',
    requestId,
    retryable: true
  }
}

const normalizeResultError = (
  error: unknown,
  requestId: string
): GetStudyResultError => {
  if (error instanceof MockDatabaseError) {
    if (error.code === 'AUTH_REQUIRED') {
      return {
        code: 'AUTHENTICATION_REQUIRED',
        message: '학습 결과를 조회하려면 인증 정보가 필요합니다.',
        requestId,
        retryable: false
      }
    }
    if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') {
      return {
        code: 'RESOURCE_NOT_FOUND',
        message: '학습 세션을 찾을 수 없습니다.',
        requestId,
        retryable: false
      }
    }
    if (error.code === 'STUDY_RESULT_NOT_READY') {
      return {
        code: 'STUDY_RESULT_NOT_READY',
        message: error.message,
        requestId,
        retryable: false
      }
    }
  }

  console.error('Mock v1 getStudyResult failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '학습 결과를 불러오지 못했습니다.',
    requestId,
    retryable: true
  }
}

export const studySessionV1Handlers = [
  http.post('*/api/v1/study-sessions', async ({ request }) => {
    const requestId = crypto.randomUUID()

    if (
      !JSON_CONTENT_TYPE_PATTERN.test(request.headers.get('Content-Type') ?? '')
    ) {
      return createCreateErrorResponse({
        code: 'INVALID_REQUEST',
        message: 'JSON 요청만 허용됩니다.',
        requestId,
        retryable: false
      })
    }

    try {
      const input = await parseJsonBody(request, createStudySessionBodySchema)

      if (input.mode !== 'RANDOM') {
        return createCreateErrorResponse({
          code: 'VALIDATION_ERROR',
          message: '현재 RANDOM 출제 모드만 사용할 수 있습니다.',
          fieldErrors: { mode: ['현재 RANDOM 모드만 지원합니다.'] },
          requestId,
          retryable: false
        })
      }
      if (input.explicitQuestionIds) {
        return createCreateErrorResponse({
          code: 'VALIDATION_ERROR',
          message: '명시 문제 출제는 아직 사용할 수 없습니다.',
          fieldErrors: {
            explicitQuestionIds: ['명시 문제 출제는 아직 지원하지 않습니다.']
          },
          requestId,
          retryable: false
        })
      }

      const isGuest = mockDatabase.getCurrentUser() === null
      const inspectedGuestProof = inspectMockGuestProof(request)
      const canReuseGuestProof =
        isGuest &&
        inspectedGuestProof.kind === 'VERIFIED' &&
        mockDatabase.isCanonicalGuestPrincipalActive(inspectedGuestProof.id)
      const canonicalGuestPrincipalId = isGuest
        ? canReuseGuestProof && inspectedGuestProof.kind === 'VERIFIED'
          ? inspectedGuestProof.id
          : crypto.randomUUID()
        : undefined
      const shouldIssueGuestCookie = isGuest && !canReuseGuestProof
      const created = mockDatabase.createStudySession({
        canonicalContractVersion: 1,
        ...(canonicalGuestPrincipalId ? { canonicalGuestPrincipalId } : {}),
        level: input.level,
        subject: input.subject,
        mode: 'RANDOM',
        count: input.count
      })
      const response = createStudySessionResponseSchema.parse(
        toContractStudySessionPayload(
          mockDatabase.getCanonicalStudySessionSnapshotRecord(
            created.session.id,
            canonicalGuestPrincipalId ?? null
          )
        )
      )

      return HttpResponse.json(response, {
        status: 201,
        headers: {
          ...getHeaders(requestId),
          ...(canonicalGuestPrincipalId && shouldIssueGuestCookie
            ? {
                'Set-Cookie': createMockGuestPrincipalCookie(
                  canonicalGuestPrincipalId
                )
              }
            : {})
        }
      })
    } catch (error: unknown) {
      return createCreateErrorResponse(normalizeCreateError(error, requestId))
    }
  }),
  http.get('*/api/v1/study-sessions/:sessionId', ({ params, request }) => {
    const requestId = crypto.randomUUID()
    const parsedParams = getStudySessionParamsSchema.safeParse({
      sessionId: String(params.sessionId ?? '')
    })

    if (!parsedParams.success) {
      return createGetErrorResponse({
        code: 'INVALID_ID',
        message: '학습 세션 ID 형식이 올바르지 않습니다.',
        requestId,
        retryable: false
      })
    }

    try {
      const inspectedGuestProof = inspectMockGuestProof(request)
      if (
        mockDatabase.getCurrentUser() === null &&
        inspectedGuestProof.kind === 'ABSENT'
      ) {
        return createGetErrorResponse({
          code: 'AUTHENTICATION_REQUIRED',
          message: '학습 세션을 조회하려면 인증 정보가 필요합니다.',
          requestId,
          retryable: false
        })
      }
      if (
        mockDatabase.getCurrentUser() === null &&
        (inspectedGuestProof.kind === 'INVALID' ||
          (inspectedGuestProof.kind === 'VERIFIED' &&
            !mockDatabase.isCanonicalGuestPrincipalActive(
              inspectedGuestProof.id
            )))
      ) {
        return createGetErrorResponse({
          code: 'GUEST_SESSION_EXPIRED',
          message: '게스트 세션이 만료됐습니다.',
          requestId,
          retryable: false
        })
      }
      const source = mockDatabase.getCanonicalStudySessionSnapshotRecord(
        parsedParams.data.sessionId,
        inspectedGuestProof.kind === 'VERIFIED' ? inspectedGuestProof.id : null
      )
      if (source.session.mode !== 'RANDOM') {
        return createGetErrorResponse({
          code: 'RESOURCE_NOT_FOUND',
          message: '학습 세션을 찾을 수 없습니다.',
          requestId,
          retryable: false
        })
      }
      const response = getStudySessionResponseSchema.parse(
        toContractStudySessionPayload(source)
      )

      return HttpResponse.json(response, {
        headers: getHeaders(requestId)
      })
    } catch (error: unknown) {
      return createGetErrorResponse(normalizeGetError(error, requestId))
    }
  }),
  http.post(
    '*/api/v1/study-sessions/:sessionId/submission',
    async ({ params, request }) => {
      const requestId = crypto.randomUUID()

      if (
        !JSON_CONTENT_TYPE_PATTERN.test(
          request.headers.get('Content-Type') ?? ''
        )
      ) {
        return createSubmitErrorResponse({
          code: 'INVALID_REQUEST',
          message: 'JSON 요청만 허용됩니다.',
          requestId,
          retryable: false
        })
      }

      const origin = request.headers.get('Origin')
      const fetchSite = request.headers.get('Sec-Fetch-Site')
      const allowedOrigins = new Set([
        new URL(request.url).origin,
        ...(typeof globalThis.location?.origin === 'string'
          ? [globalThis.location.origin]
          : [])
      ])
      const hasTrustedOrigin = origin !== null && allowedOrigins.has(origin)
      const isSyntheticSameOrigin =
        origin === null && (fetchSite === null || fetchSite === 'same-origin')
      if (!hasTrustedOrigin && !isSyntheticSameOrigin) {
        return createSubmitErrorResponse({
          code: 'UNTRUSTED_ORIGIN',
          message: '허용되지 않은 요청 출처입니다.',
          requestId,
          retryable: false
        })
      }

      const parsedParams = submitStudySessionParamsSchema.safeParse({
        sessionId: String(params.sessionId ?? '')
      })
      if (!parsedParams.success) {
        return createSubmitErrorResponse({
          code: 'VALIDATION_ERROR',
          message: '학습 세션 ID 형식이 올바르지 않습니다.',
          requestId,
          retryable: false
        })
      }

      const parsedHeaders = submitStudySessionHeadersSchema.safeParse({
        'idempotency-key': request.headers.get('Idempotency-Key') ?? undefined
      })
      if (!parsedHeaders.success) {
        return createSubmitErrorResponse({
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: '유효한 Idempotency-Key UUID header가 필요합니다.',
          requestId,
          retryable: false
        })
      }

      try {
        const body = await parseCanonicalSubmitBody(request)
        const currentUser = mockDatabase.getCurrentUser()
        const inspectedGuestProof = inspectMockGuestProof(request)
        if (!currentUser && inspectedGuestProof.kind === 'ABSENT') {
          return createSubmitErrorResponse({
            code: 'AUTHENTICATION_REQUIRED',
            message: '학습 세션을 제출하려면 인증 정보가 필요합니다.',
            requestId,
            retryable: false
          })
        }
        if (
          !currentUser &&
          (inspectedGuestProof.kind === 'INVALID' ||
            (inspectedGuestProof.kind === 'VERIFIED' &&
              !mockDatabase.isCanonicalGuestPrincipalActive(
                inspectedGuestProof.id
              )))
        ) {
          return createSubmitErrorResponse({
            code: 'GUEST_SESSION_EXPIRED',
            message: '게스트 세션이 만료됐습니다.',
            requestId,
            retryable: false
          })
        }

        const guestPrincipalId =
          !currentUser && inspectedGuestProof.kind === 'VERIFIED'
            ? inspectedGuestProof.id
            : null
        const submitted = mockDatabase.submitCanonicalStudySession(
          {
            body,
            guestPrincipalId,
            idempotencyKey: parsedHeaders.data['idempotency-key'],
            sessionId: parsedParams.data.sessionId
          },
          mockCanonicalSubmissionOperations
        )
        const response = submitStudySessionResponseSchema.parse(
          submitted.response
        )

        return HttpResponse.json(response, {
          status: 201,
          headers: {
            ...getHeaders(requestId),
            ...(submitted.replayed ? { 'Idempotency-Replayed': 'true' } : {}),
            ...(guestPrincipalId
              ? {
                  'Set-Cookie': createMockGuestPrincipalCookie(guestPrincipalId)
                }
              : {})
          }
        })
      } catch (error: unknown) {
        const normalized = normalizeSubmitError(error, requestId)
        const location =
          normalized.code === 'SESSION_ALREADY_SUBMITTED'
            ? `/api/v1/study-sessions/${parsedParams.data.sessionId}/result`
            : undefined
        return createSubmitErrorResponse(normalized, location)
      }
    }
  ),
  http.get(
    '*/api/v1/study-sessions/:sessionId/result',
    ({ params, request }) => {
      const requestId = crypto.randomUUID()
      const parsedParams = getStudyResultParamsSchema.safeParse({
        sessionId: String(params.sessionId ?? '')
      })

      if (!parsedParams.success) {
        return createResultErrorResponse({
          code: 'INVALID_ID',
          message: '학습 세션 ID 형식이 올바르지 않습니다.',
          requestId,
          retryable: false
        })
      }

      try {
        const currentUser = mockDatabase.getCurrentUser()
        const inspectedGuestProof = inspectMockGuestProof(request)
        if (!currentUser && inspectedGuestProof.kind === 'ABSENT') {
          return createResultErrorResponse({
            code: 'AUTHENTICATION_REQUIRED',
            message: '학습 결과를 조회하려면 인증 정보가 필요합니다.',
            requestId,
            retryable: false
          })
        }
        if (
          !currentUser &&
          (inspectedGuestProof.kind === 'INVALID' ||
            (inspectedGuestProof.kind === 'VERIFIED' &&
              !mockDatabase.isCanonicalGuestPrincipalActive(
                inspectedGuestProof.id
              )))
        ) {
          return createResultErrorResponse({
            code: 'GUEST_SESSION_EXPIRED',
            message: '게스트 세션이 만료됐습니다.',
            requestId,
            retryable: false
          })
        }

        const response = getStudyResultResponseSchema.parse(
          mockDatabase.getCanonicalStudyResult(
            parsedParams.data.sessionId,
            !currentUser && inspectedGuestProof.kind === 'VERIFIED'
              ? inspectedGuestProof.id
              : null
          )
        )

        return HttpResponse.json(response, {
          headers: getHeaders(requestId)
        })
      } catch (error: unknown) {
        return createResultErrorResponse(normalizeResultError(error, requestId))
      }
    }
  )
]

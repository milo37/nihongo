import { errorStatusByCode } from '@nihongo/contracts/common/error'
import {
  createStudySessionBodySchema,
  createStudySessionErrorSchema,
  createStudySessionResponseSchema,
  createStudySessionV2ResponseSchema,
  type CreateStudySessionError
} from '@nihongo/contracts/study/create-study-session'
import {
  getStudySessionErrorSchema,
  getStudySessionParamsSchema,
  getStudySessionResponseSchema,
  getStudySessionV2ResponseSchema,
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
  submitStudySessionV2BodySchema,
  submitStudySessionV2ErrorSchema,
  submitStudySessionV2HeadersSchema,
  submitStudySessionV2ResponseSchema,
  type ParsedSubmitStudySessionBody,
  type ParsedSubmitStudySessionV2Body,
  type SubmitStudySessionError,
  type SubmitStudySessionV2Error
} from '@nihongo/contracts/study/submit-study-session'
import { http, HttpResponse } from 'msw'
import {
  MockCanonicalSubmissionIntegrityError,
  MockCanonicalSubmissionValidationError,
  mockCanonicalSubmissionOperations,
  mockCanonicalSubmissionV2Operations
} from '@mocks/adapters/studySubmissionContractAdapter'
import {
  toContractStudySessionPayload,
  toVersionedContractStudySessionPayload
} from '@mocks/adapters/studySessionContractAdapter'
import {
  createMockGuestPrincipalCookie,
  inspectMockGuestProof
} from '@mocks/guestPrincipal'
import {
  hasTrustedMockWriteOrigin,
  MockHttpError,
  parseBoundedJsonBody,
  readBoundedMockJsonObject
} from '@mocks/handlers/shared'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'

const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;|$)/iu

const getRequestedPracticeContractVersion = (
  request: Request
): 1 | 2 | null => {
  const header = request.headers.get('X-Nihongo-Practice-Contract')
  if (header === null) {
    return 1
  }
  if (header === '2') {
    return 2
  }
  return null
}

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
  error: SubmitStudySessionError | SubmitStudySessionV2Error,
  contractVersion: 1 | 2,
  location?: string
): HttpResponse<SubmitStudySessionError | SubmitStudySessionV2Error> => {
  const payload =
    contractVersion === 2
      ? submitStudySessionV2ErrorSchema.parse(error)
      : submitStudySessionErrorSchema.parse(error)

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
    if (error.code === 'INVALID_REQUEST') {
      return {
        code: 'INVALID_REQUEST',
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
  request: Request,
  contractVersion: 1 | 2
): Promise<ParsedSubmitStudySessionBody | ParsedSubmitStudySessionV2Body> => {
  const body = await readBoundedMockJsonObject(request)

  const parsed =
    contractVersion === 2
      ? submitStudySessionV2BodySchema.safeParse(body)
      : submitStudySessionBodySchema.safeParse(body)
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
): SubmitStudySessionError | SubmitStudySessionV2Error => {
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
      DRAFT_SUBMIT_MISMATCH: 'DRAFT_SUBMIT_MISMATCH',
      DRAFT_VERSION_CONFLICT: 'DRAFT_VERSION_CONFLICT',
      PRACTICE_CONTRACT_VERSION_MISMATCH: 'PRACTICE_CONTRACT_VERSION_MISMATCH',
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
    const practiceContractVersion = getRequestedPracticeContractVersion(request)

    if (practiceContractVersion === null) {
      return createCreateErrorResponse({
        code: 'INVALID_REQUEST',
        message: 'X-Nihongo-Practice-Contract header 값이 올바르지 않습니다.',
        requestId,
        retryable: false
      })
    }

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

    if (!hasTrustedMockWriteOrigin(request)) {
      return createCreateErrorResponse({
        code: 'UNTRUSTED_ORIGIN',
        message: '허용되지 않은 요청 출처입니다.',
        requestId,
        retryable: false
      })
    }

    try {
      const input = await parseBoundedJsonBody(
        request,
        createStudySessionBodySchema
      )

      if (input.mode !== 'RANDOM') {
        return createCreateErrorResponse({
          code: 'VALIDATION_ERROR',
          message: '현재 RANDOM 출제 모드만 사용할 수 있습니다.',
          fieldErrors: { mode: ['현재 RANDOM 모드만 지원합니다.'] },
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
        canonicalContractVersion: practiceContractVersion,
        ...(canonicalGuestPrincipalId ? { canonicalGuestPrincipalId } : {}),
        level: input.level,
        subject: input.subject,
        mode: 'RANDOM',
        count: input.count
      })
      const source = mockDatabase.getCanonicalStudySessionSnapshotRecord(
        created.session.id,
        canonicalGuestPrincipalId ?? null
      )
      const response =
        practiceContractVersion === 2
          ? createStudySessionV2ResponseSchema.parse(
              toVersionedContractStudySessionPayload(source)
            )
          : createStudySessionResponseSchema.parse(
              toContractStudySessionPayload(source)
            )

      return HttpResponse.json(response, {
        status: 201,
        headers: {
          ...getHeaders(requestId),
          'X-Nihongo-Practice-Contract': String(practiceContractVersion),
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
    const requestedPracticeContractVersion =
      getRequestedPracticeContractVersion(request)
    if (requestedPracticeContractVersion === null) {
      return createGetErrorResponse({
        code: 'INVALID_REQUEST',
        message: 'X-Nihongo-Practice-Contract header 값이 올바르지 않습니다.',
        requestId,
        retryable: false
      })
    }
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
      if (
        requestedPracticeContractVersion === 1 &&
        source.practiceContractVersion === 2
      ) {
        return createGetErrorResponse({
          code: 'PRACTICE_CONTRACT_VERSION_MISMATCH',
          message: 'v2 학습 세션은 practice contract header 2가 필요합니다.',
          requestId,
          retryable: false
        })
      }
      const response =
        requestedPracticeContractVersion === 2
          ? getStudySessionV2ResponseSchema.parse(
              toVersionedContractStudySessionPayload(source)
            )
          : getStudySessionResponseSchema.parse(
              toContractStudySessionPayload(source)
            )

      return HttpResponse.json(response, {
        headers: {
          ...getHeaders(requestId),
          'X-Nihongo-Practice-Contract': String(
            source.practiceContractVersion ?? 1
          )
        }
      })
    } catch (error: unknown) {
      return createGetErrorResponse(normalizeGetError(error, requestId))
    }
  }),
  http.post(
    '*/api/v1/study-sessions/:sessionId/submission',
    async ({ params, request }) => {
      const requestId = crypto.randomUUID()
      const practiceContractVersion =
        getRequestedPracticeContractVersion(request)
      if (practiceContractVersion === null) {
        return createSubmitErrorResponse(
          {
            code: 'INVALID_REQUEST',
            message:
              'X-Nihongo-Practice-Contract header 값이 올바르지 않습니다.',
            requestId,
            retryable: false
          },
          1
        )
      }

      if (
        !JSON_CONTENT_TYPE_PATTERN.test(
          request.headers.get('Content-Type') ?? ''
        )
      ) {
        return createSubmitErrorResponse(
          {
            code: 'INVALID_REQUEST',
            message: 'JSON 요청만 허용됩니다.',
            requestId,
            retryable: false
          },
          practiceContractVersion
        )
      }

      if (!hasTrustedMockWriteOrigin(request)) {
        return createSubmitErrorResponse(
          {
            code: 'UNTRUSTED_ORIGIN',
            message: '허용되지 않은 요청 출처입니다.',
            requestId,
            retryable: false
          },
          practiceContractVersion
        )
      }

      const parsedParams = submitStudySessionParamsSchema.safeParse({
        sessionId: String(params.sessionId ?? '')
      })
      if (!parsedParams.success) {
        return createSubmitErrorResponse(
          {
            code: 'VALIDATION_ERROR',
            message: '학습 세션 ID 형식이 올바르지 않습니다.',
            requestId,
            retryable: false
          },
          practiceContractVersion
        )
      }

      const parsedHeaders =
        practiceContractVersion === 2
          ? submitStudySessionV2HeadersSchema.safeParse({
              'idempotency-key':
                request.headers.get('Idempotency-Key') ?? undefined,
              'x-nihongo-practice-contract':
                request.headers.get('X-Nihongo-Practice-Contract') ?? undefined
            })
          : submitStudySessionHeadersSchema.safeParse({
              'idempotency-key':
                request.headers.get('Idempotency-Key') ?? undefined
            })
      if (!parsedHeaders.success) {
        return createSubmitErrorResponse(
          {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: '유효한 Idempotency-Key UUID header가 필요합니다.',
            requestId,
            retryable: false
          },
          practiceContractVersion
        )
      }

      try {
        const body = await parseCanonicalSubmitBody(
          request,
          practiceContractVersion
        )
        const currentUser = mockDatabase.getCurrentUser()
        const inspectedGuestProof = inspectMockGuestProof(request)
        if (!currentUser && inspectedGuestProof.kind === 'ABSENT') {
          return createSubmitErrorResponse(
            {
              code: 'AUTHENTICATION_REQUIRED',
              message: '학습 세션을 제출하려면 인증 정보가 필요합니다.',
              requestId,
              retryable: false
            },
            practiceContractVersion
          )
        }
        if (
          !currentUser &&
          (inspectedGuestProof.kind === 'INVALID' ||
            (inspectedGuestProof.kind === 'VERIFIED' &&
              !mockDatabase.isCanonicalGuestPrincipalActive(
                inspectedGuestProof.id
              )))
        ) {
          return createSubmitErrorResponse(
            {
              code: 'GUEST_SESSION_EXPIRED',
              message: '게스트 세션이 만료됐습니다.',
              requestId,
              retryable: false
            },
            practiceContractVersion
          )
        }

        const guestPrincipalId =
          !currentUser && inspectedGuestProof.kind === 'VERIFIED'
            ? inspectedGuestProof.id
            : null
        const submitted = mockDatabase.submitCanonicalStudySession(
          {
            body,
            contractVersion: practiceContractVersion,
            guestPrincipalId,
            idempotencyKey: parsedHeaders.data['idempotency-key'],
            sessionId: parsedParams.data.sessionId
          },
          practiceContractVersion === 2
            ? mockCanonicalSubmissionV2Operations
            : mockCanonicalSubmissionOperations
        )
        const response =
          practiceContractVersion === 2
            ? submitStudySessionV2ResponseSchema.parse(submitted.response)
            : submitStudySessionResponseSchema.parse(submitted.response)

        return HttpResponse.json(response, {
          status: 201,
          headers: {
            ...getHeaders(requestId),
            'X-Nihongo-Practice-Contract': String(practiceContractVersion),
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
        return createSubmitErrorResponse(
          normalized,
          practiceContractVersion,
          location
        )
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

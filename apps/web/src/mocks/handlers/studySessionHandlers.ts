import { errorStatusByCode } from '@nihongo/contracts/common/error'
import {
  createStudySessionErrorSchema,
  createStudySessionV2BodySchema,
  createStudySessionV2ResponseSchema,
  type CreateStudySessionError
} from '@nihongo/contracts/study/create-study-session'
import {
  getStudySessionErrorSchema,
  getStudySessionParamsSchema,
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
  submitStudySessionParamsSchema,
  submitStudySessionV2BodySchema,
  submitStudySessionV2ErrorSchema,
  submitStudySessionV2HeadersSchema,
  submitStudySessionV2ResponseSchema,
  type ParsedSubmitStudySessionV2Body,
  type SubmitStudySessionV2Error
} from '@nihongo/contracts/study/submit-study-session'
import { http, HttpResponse } from 'msw'
import {
  MockCanonicalSubmissionIntegrityError,
  MockCanonicalSubmissionValidationError,
  mockCanonicalSubmissionV2Operations
} from '@mocks/adapters/studySubmissionContractAdapter'
import { toVersionedContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
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
import { GUEST_SESSION_QUESTION_LIMIT } from '@nihongo/contracts/study/guest-limits'
import { mockGuestAllowance } from '@mocks/handlers/guestAllowanceHandlers'

const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;|$)/iu

/** Same field error as the API's assertPracticeContractHeader. */
const practiceContractFieldErrors = {
  'x-nihongo-practice-contract': ['header 값은 2만 허용합니다.']
}

/** Practice contract 2 is the only contract; the header may be omitted. */
const hasSupportedPracticeContract = (request: Request): boolean => {
  const header = request.headers.get('X-Nihongo-Practice-Contract')
  return header === null || header === '2'
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
  error: SubmitStudySessionV2Error,
  location?: string
): HttpResponse<SubmitStudySessionV2Error> => {
  const payload = submitStudySessionV2ErrorSchema.parse(error)

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

  console.error('Mock createStudySession failed', error)
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

  console.error('Mock getStudySession failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '학습 세션을 불러오지 못했습니다.',
    requestId,
    retryable: true
  }
}

const parseCanonicalSubmitBody = async (
  request: Request
): Promise<ParsedSubmitStudySessionV2Body> => {
  const body = await readBoundedMockJsonObject(request)

  const parsed = submitStudySessionV2BodySchema.safeParse(body)
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
): SubmitStudySessionV2Error => {
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
    console.error('Mock submitStudySession failed', error)
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

  console.error('Mock getStudyResult failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '학습 결과를 불러오지 못했습니다.',
    requestId,
    retryable: true
  }
}

export const studySessionHandlers = [
  http.post('*/api/v1/study-sessions', async ({ request, cookies }) => {
    const requestId = crypto.randomUUID()

    if (!hasSupportedPracticeContract(request)) {
      return createCreateErrorResponse({
        code: 'INVALID_REQUEST',
        message: 'X-Nihongo-Practice-Contract header 값이 올바르지 않습니다.',
        fieldErrors: practiceContractFieldErrors,
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
        createStudySessionV2BodySchema
      )
      const currentUser = mockDatabase.getCurrentUser()
      const isGuest = currentUser === null
      if (currentUser && mockDatabase.isAccountRestricted(currentUser.id)) {
        return createCreateErrorResponse({
          code: 'ACCOUNT_RESTRICTED',
          message: '임시로 이용이 제한된 계정입니다.',
          requestId,
          retryable: false
        })
      }
      // Guests only try short random sessions, a few a day (#737).
      if (isGuest && input.mode !== 'RANDOM') {
        return createCreateErrorResponse({
          code: 'AUTHENTICATION_REQUIRED',
          message: '이 출제 모드는 로그인이 필요합니다.',
          requestId,
          retryable: false
        })
      }
      const guestLimits = isGuest && mockGuestAllowance.isEnforced()
      if (guestLimits && input.count !== GUEST_SESSION_QUESTION_LIMIT) {
        return createCreateErrorResponse({
          code: 'VALIDATION_ERROR',
          message: `비회원은 ${GUEST_SESSION_QUESTION_LIMIT}문제씩 풀 수 있습니다.`,
          fieldErrors: {
            count: [`${GUEST_SESSION_QUESTION_LIMIT}이어야 합니다.`]
          },
          requestId,
          retryable: false
        })
      }
      if (guestLimits && mockGuestAllowance.remaining() === 0) {
        return createCreateErrorResponse({
          code: 'GUEST_LIMIT_REACHED',
          message:
            '비회원은 하루 2번까지 풀 수 있습니다. 더 풀려면 로그인해 주세요.',
          details: { resetsAt: mockGuestAllowance.resetsAt() },
          requestId,
          retryable: false
        })
      }
      const inspectedGuestProof = inspectMockGuestProof(request, cookies)
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
        canonicalContractVersion: 2,
        ...(canonicalGuestPrincipalId ? { canonicalGuestPrincipalId } : {}),
        level: input.level,
        subject: input.subject,
        mode: input.mode,
        count: input.count,
        ...('reviewFilter' in input && input.reviewFilter
          ? { reviewFilter: input.reviewFilter }
          : {})
      })
      if (isGuest) mockGuestAllowance.record()
      const source = mockDatabase.getCanonicalStudySessionSnapshotRecord(
        created.session.id,
        canonicalGuestPrincipalId ?? null
      )
      const response = createStudySessionV2ResponseSchema.parse(
        toVersionedContractStudySessionPayload(source)
      )

      return HttpResponse.json(response, {
        status: 201,
        headers: {
          ...getHeaders(requestId),
          'X-Nihongo-Practice-Contract': '2',
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
  http.get(
    '*/api/v1/study-sessions/:sessionId',
    ({ params, request, cookies }) => {
      const requestId = crypto.randomUUID()
      if (!hasSupportedPracticeContract(request)) {
        return createGetErrorResponse({
          code: 'INVALID_REQUEST',
          message: 'X-Nihongo-Practice-Contract header 값이 올바르지 않습니다.',
          fieldErrors: practiceContractFieldErrors,
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
        const inspectedGuestProof = inspectMockGuestProof(request, cookies)
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
          inspectedGuestProof.kind === 'VERIFIED'
            ? inspectedGuestProof.id
            : null
        )
        const response = getStudySessionV2ResponseSchema.parse(
          toVersionedContractStudySessionPayload(source)
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
    }
  ),
  http.post(
    '*/api/v1/study-sessions/:sessionId/submission',
    async ({ params, request, cookies }) => {
      const requestId = crypto.randomUUID()
      if (!hasSupportedPracticeContract(request)) {
        return createSubmitErrorResponse({
          code: 'INVALID_REQUEST',
          message: 'X-Nihongo-Practice-Contract header 값이 올바르지 않습니다.',
          fieldErrors: practiceContractFieldErrors,
          requestId,
          retryable: false
        })
      }

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

      if (!hasTrustedMockWriteOrigin(request)) {
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

      const parsedHeaders = submitStudySessionV2HeadersSchema.safeParse({
        'idempotency-key': request.headers.get('Idempotency-Key') ?? undefined,
        'x-nihongo-practice-contract':
          request.headers.get('X-Nihongo-Practice-Contract') ?? '2'
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
        const inspectedGuestProof = inspectMockGuestProof(request, cookies)
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
            contractVersion: 2,
            guestPrincipalId,
            idempotencyKey: parsedHeaders.data['idempotency-key'],
            sessionId: parsedParams.data.sessionId
          },
          mockCanonicalSubmissionV2Operations
        )
        const response = submitStudySessionV2ResponseSchema.parse(
          submitted.response
        )

        return HttpResponse.json(response, {
          status: 201,
          headers: {
            ...getHeaders(requestId),
            'X-Nihongo-Practice-Contract': '2',
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
    ({ params, request, cookies }) => {
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
        const inspectedGuestProof = inspectMockGuestProof(request, cookies)
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

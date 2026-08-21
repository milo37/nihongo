import { errorStatusByCode } from '@nihongo/contracts/common/error'
import {
  createResultRetrySessionBodySchema,
  createResultRetrySessionErrorSchema,
  createResultRetrySessionHeadersSchema,
  createResultRetrySessionParamsSchema,
  createResultRetrySessionResponseSchema,
  type CreateResultRetrySessionError
} from '@nihongo/contracts/study/create-result-retry-session'
import { http, HttpResponse } from 'msw'
import { inspectMockGuestProof } from '@mocks/guestPrincipal'
import {
  hasTrustedMockWriteOrigin,
  MockHttpError,
  readBoundedMockJsonObject
} from '@mocks/handlers/shared'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'

const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;|$)/iu

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

const createErrorResponse = (
  error: CreateResultRetrySessionError
): HttpResponse<CreateResultRetrySessionError> => {
  const payload = createResultRetrySessionErrorSchema.parse(error)
  return HttpResponse.json(payload, {
    status: errorStatusByCode[payload.code],
    headers: getHeaders(payload.requestId, payload.code)
  })
}

const normalizeError = (
  error: unknown,
  requestId: string
): CreateResultRetrySessionError => {
  if (error instanceof MockHttpError) {
    if (error.code === 'INVALID_JSON') {
      return {
        code: 'INVALID_JSON',
        message: error.message,
        requestId,
        retryable: false
      }
    }
    return {
      code: 'INVALID_REQUEST',
      message: error.message,
      requestId,
      retryable: false
    }
  }

  if (error instanceof MockDatabaseError) {
    if (error.code === 'AUTH_REQUIRED') {
      return {
        code: 'GUEST_SESSION_EXPIRED',
        message: '게스트 세션이 만료됐습니다.',
        requestId,
        retryable: false
      }
    }
    if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') {
      return {
        code: 'RESOURCE_NOT_FOUND',
        message: '학습 결과를 찾을 수 없습니다.',
        requestId,
        retryable: false
      }
    }
    if (error.code === 'IDEMPOTENCY_KEY_REUSED') {
      return {
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: error.message,
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
    if (error.code === 'NO_ELIGIBLE_QUESTIONS') {
      return {
        code: 'NO_ELIGIBLE_QUESTIONS',
        message: error.message,
        requestId,
        retryable: false
      }
    }
  }

  console.error('Mock createResultRetrySession failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: '오답 재시도 세션을 만들지 못했습니다.',
    requestId,
    retryable: true
  }
}

export const studyResultRetryHandlers = [
  http.post(
    '*/api/v1/study-sessions/:sessionId/retry',
    async ({ params, request }) => {
      const requestId = crypto.randomUUID()
      if (
        !JSON_CONTENT_TYPE_PATTERN.test(
          request.headers.get('Content-Type') ?? ''
        )
      ) {
        return createErrorResponse({
          code: 'INVALID_REQUEST',
          message: 'JSON 요청만 허용됩니다.',
          requestId,
          retryable: false
        })
      }
      if (!hasTrustedMockWriteOrigin(request)) {
        return createErrorResponse({
          code: 'UNTRUSTED_ORIGIN',
          message: '허용되지 않은 요청 출처입니다.',
          requestId,
          retryable: false
        })
      }

      const parsedParams = createResultRetrySessionParamsSchema.safeParse({
        sessionId: String(params.sessionId ?? '')
      })
      if (!parsedParams.success) {
        return createErrorResponse({
          code: 'INVALID_ID',
          message: '학습 세션 ID 형식이 올바르지 않습니다.',
          requestId,
          retryable: false
        })
      }
      if (request.headers.get('X-Nihongo-Practice-Contract') !== '2') {
        return createErrorResponse({
          code: 'INVALID_REQUEST',
          message: '오답 재출제에는 practice contract 2가 필요합니다.',
          requestId,
          retryable: false
        })
      }
      const parsedHeaders = createResultRetrySessionHeadersSchema.safeParse({
        'idempotency-key': request.headers.get('Idempotency-Key') ?? undefined,
        'x-nihongo-practice-contract':
          request.headers.get('X-Nihongo-Practice-Contract') ?? undefined
      })
      if (!parsedHeaders.success) {
        return createErrorResponse({
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: '유효한 Idempotency-Key UUID header가 필요합니다.',
          requestId,
          retryable: false
        })
      }

      try {
        const body = await readBoundedMockJsonObject(request)
        const parsedBody = createResultRetrySessionBodySchema.safeParse(body)
        if (!parsedBody.success) {
          throw new MockHttpError(
            400,
            'INVALID_REQUEST',
            '오답 재출제 요청 본문은 빈 JSON object여야 합니다.'
          )
        }

        const currentUser = mockDatabase.getCurrentUser()
        const guestProof = inspectMockGuestProof(request)
        if (!currentUser && guestProof.kind === 'ABSENT') {
          return createErrorResponse({
            code: 'AUTHENTICATION_REQUIRED',
            message: '오답을 다시 풀려면 인증 정보가 필요합니다.',
            requestId,
            retryable: false
          })
        }
        if (
          !currentUser &&
          (guestProof.kind === 'INVALID' ||
            (guestProof.kind === 'VERIFIED' &&
              !mockDatabase.isCanonicalGuestPrincipalActive(guestProof.id)))
        ) {
          return createErrorResponse({
            code: 'GUEST_SESSION_EXPIRED',
            message: '게스트 세션이 만료됐습니다.',
            requestId,
            retryable: false
          })
        }

        const created = mockDatabase.createCanonicalResultRetry({
          guestPrincipalId:
            !currentUser && guestProof.kind === 'VERIFIED'
              ? guestProof.id
              : null,
          idempotencyKey: parsedHeaders.data['idempotency-key'],
          sourceSessionId: parsedParams.data.sessionId
        })
        const response = createResultRetrySessionResponseSchema.parse(
          created.response
        )
        return HttpResponse.json(response, {
          status: 201,
          headers: {
            ...getHeaders(requestId),
            'X-Nihongo-Practice-Contract': '2',
            Location: `/api/v1/study-sessions/${response.session.id}`,
            ...(created.replayed ? { 'Idempotency-Replayed': 'true' } : {})
          }
        })
      } catch (error: unknown) {
        return createErrorResponse(normalizeError(error, requestId))
      }
    }
  )
]

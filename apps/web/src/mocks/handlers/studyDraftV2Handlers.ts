import { errorStatusByCode } from '@nihongo/contracts/common/error'
import {
  cancelStudySessionBodySchema,
  cancelStudySessionErrorSchema,
  cancelStudySessionParamsSchema
} from '@nihongo/contracts/study/cancel-study-session'
import {
  getStudyDraftAnswersErrorSchema,
  getStudyDraftAnswersParamsSchema,
  getStudyDraftAnswersResponseSchema
} from '@nihongo/contracts/study/get-study-draft-answers'
import {
  listResumableStudySessionsErrorSchema,
  listResumableStudySessionsQuerySchema,
  listResumableStudySessionsResponseSchema
} from '@nihongo/contracts/study/list-resumable-study-sessions'
import {
  saveStudyDraftAnswersBodySchema,
  saveStudyDraftAnswersErrorSchema,
  saveStudyDraftAnswersHeadersSchema,
  saveStudyDraftAnswersParamsSchema,
  saveStudyDraftAnswersResponseSchema
} from '@nihongo/contracts/study/save-study-draft-answers'
import { http, HttpResponse } from 'msw'
import { z, type ZodType } from 'zod'
import { inspectMockGuestProof } from '@mocks/guestPrincipal'
import {
  hasTrustedMockWriteOrigin,
  MockHttpError,
  readBoundedMockJsonObject
} from '@mocks/handlers/shared'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'

const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;|$)/iu

interface ErrorPayload {
  code: string
  message: string
  requestId: string
  retryable: boolean
}

const responseHeaders = (
  requestId: string,
  code?: string
): Record<string, string> => ({
  'Cache-Control': 'private, no-store',
  'X-Nihongo-Practice-Contract': '2',
  'X-Request-Id': requestId,
  ...(code === 'RATE_LIMITED'
    ? { 'Retry-After': '30' }
    : code === 'SERVICE_UNAVAILABLE'
      ? { 'Retry-After': '5' }
      : {})
})

const errorResponse = <Schema extends ZodType>(
  schema: Schema,
  error: ErrorPayload
): HttpResponse<ErrorPayload> => {
  const payload = schema.parse(error) as ErrorPayload
  return HttpResponse.json(payload, {
    status: errorStatusByCode[payload.code as keyof typeof errorStatusByCode],
    headers: responseHeaders(payload.requestId, payload.code)
  })
}

const hasRequiredPracticeHeader = (request: Request): boolean =>
  request.headers.get('X-Nihongo-Practice-Contract') === '2'

const parseSaveDraftBody = async (
  request: Request
): Promise<z.output<typeof saveStudyDraftAnswersBodySchema>> => {
  const parsed = saveStudyDraftAnswersBodySchema.safeParse(
    await readBoundedMockJsonObject(request)
  )
  if (!parsed.success) {
    const invalidDuration = parsed.error.issues.some((issue) =>
      issue.path.includes('elapsedSec')
    )
    throw new MockHttpError(
      422,
      invalidDuration ? 'INVALID_DURATION' : 'VALIDATION_ERROR',
      invalidDuration
        ? '학습 시간 값이 올바르지 않습니다.'
        : '학습 draft 저장 요청이 올바르지 않습니다.'
    )
  }
  return parsed.data
}

const parseCancellationBody = async (request: Request): Promise<void> => {
  const parsed = cancelStudySessionBodySchema.safeParse(
    await readBoundedMockJsonObject(request)
  )
  if (!parsed.success) {
    throw new MockHttpError(
      400,
      'INVALID_REQUEST',
      '학습 세션 취소 요청이 올바르지 않습니다.'
    )
  }
}

const resolveGuestPrincipalId = (
  request: Request
): {
  errorCode?: 'AUTHENTICATION_REQUIRED' | 'GUEST_SESSION_EXPIRED'
  id: string | null
} => {
  if (mockDatabase.getCurrentUser()) {
    return { id: null }
  }
  const proof = inspectMockGuestProof(request)
  if (proof.kind === 'ABSENT') {
    return { errorCode: 'AUTHENTICATION_REQUIRED', id: null }
  }
  if (
    proof.kind === 'INVALID' ||
    !mockDatabase.isCanonicalGuestPrincipalActive(proof.id)
  ) {
    return { errorCode: 'GUEST_SESSION_EXPIRED', id: null }
  }
  return { id: proof.id }
}

const normalizeDatabaseCode = (
  error: MockDatabaseError
): ErrorPayload['code'] => {
  const codeByDatabaseError = {
    ANSWER_NOT_IN_SESSION: 'ANSWER_NOT_IN_SESSION',
    AUTH_REQUIRED: 'AUTHENTICATION_REQUIRED',
    DRAFT_VERSION_CONFLICT: 'DRAFT_VERSION_CONFLICT',
    FORBIDDEN: 'RESOURCE_NOT_FOUND',
    IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
    NOT_FOUND: 'RESOURCE_NOT_FOUND',
    OPTION_NOT_IN_VERSION: 'OPTION_NOT_IN_VERSION',
    PRACTICE_CONTRACT_VERSION_MISMATCH: 'PRACTICE_CONTRACT_VERSION_MISMATCH',
    STUDY_SESSION_NOT_EDITABLE: 'STUDY_SESSION_NOT_EDITABLE'
  } as const
  return error.code in codeByDatabaseError
    ? codeByDatabaseError[error.code as keyof typeof codeByDatabaseError]
    : 'INTERNAL_SERVER_ERROR'
}

const normalizedError = (
  error: unknown,
  requestId: string,
  fallbackMessage: string
): ErrorPayload => {
  if (error instanceof MockHttpError) {
    return {
      code: error.code,
      message: error.message,
      requestId,
      retryable: false
    }
  }
  if (error instanceof MockDatabaseError) {
    const code = normalizeDatabaseCode(error)
    return {
      code,
      message:
        code === 'RESOURCE_NOT_FOUND'
          ? '학습 세션을 찾을 수 없습니다.'
          : code === 'INTERNAL_SERVER_ERROR'
            ? fallbackMessage
            : error.message,
      requestId,
      retryable: code === 'INTERNAL_SERVER_ERROR'
    }
  }
  console.error('Mock v2 practice flow failed', error)
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: fallbackMessage,
    requestId,
    retryable: true
  }
}

const parseListQuery = (
  request: Request
): z.output<typeof listResumableStudySessionsQuerySchema> => {
  const searchParams = new URL(request.url).searchParams
  const raw: Record<string, string | string[]> = {}
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key)
    raw[key] = values.length === 1 ? (values[0] ?? '') : values
  }
  const parsed = listResumableStudySessionsQuerySchema.safeParse(raw)
  if (!parsed.success) {
    throw new MockHttpError(
      422,
      'VALIDATION_ERROR',
      '재개 가능한 학습 세션 조회 조건이 올바르지 않습니다.'
    )
  }
  return parsed.data
}

export const studyDraftV2Handlers = [
  http.get('*/api/v1/study-sessions', ({ request }) => {
    const requestId = crypto.randomUUID()
    if (!hasRequiredPracticeHeader(request)) {
      return errorResponse(listResumableStudySessionsErrorSchema, {
        code: 'INVALID_REQUEST',
        message: 'X-Nihongo-Practice-Contract: 2 header가 필요합니다.',
        requestId,
        retryable: false
      })
    }
    try {
      const query = parseListQuery(request)
      const guest = resolveGuestPrincipalId(request)
      if (guest.errorCode) {
        return errorResponse(listResumableStudySessionsErrorSchema, {
          code: guest.errorCode,
          message:
            guest.errorCode === 'GUEST_SESSION_EXPIRED'
              ? '게스트 세션이 만료됐습니다.'
              : '재개 가능한 세션을 조회하려면 인증 정보가 필요합니다.',
          requestId,
          retryable: false
        })
      }
      const response = listResumableStudySessionsResponseSchema.parse(
        mockDatabase.listCanonicalResumableStudySessions(
          guest.id,
          query.page,
          query.pageSize
        )
      )
      return HttpResponse.json(response, {
        headers: responseHeaders(requestId)
      })
    } catch (error: unknown) {
      return errorResponse(
        listResumableStudySessionsErrorSchema,
        normalizedError(
          error,
          requestId,
          '재개 가능한 학습 세션을 불러오지 못했습니다.'
        )
      )
    }
  }),
  http.get(
    '*/api/v1/study-sessions/:sessionId/draft-answers',
    ({ params, request }) => {
      const requestId = crypto.randomUUID()
      if (!hasRequiredPracticeHeader(request)) {
        return errorResponse(getStudyDraftAnswersErrorSchema, {
          code: 'INVALID_REQUEST',
          message: 'X-Nihongo-Practice-Contract: 2 header가 필요합니다.',
          requestId,
          retryable: false
        })
      }
      const parsedParams = getStudyDraftAnswersParamsSchema.safeParse({
        sessionId: String(params.sessionId ?? '')
      })
      if (!parsedParams.success) {
        return errorResponse(getStudyDraftAnswersErrorSchema, {
          code: 'INVALID_ID',
          message: '학습 세션 ID 형식이 올바르지 않습니다.',
          requestId,
          retryable: false
        })
      }
      try {
        const guest = resolveGuestPrincipalId(request)
        if (guest.errorCode) {
          return errorResponse(getStudyDraftAnswersErrorSchema, {
            code: guest.errorCode,
            message:
              guest.errorCode === 'GUEST_SESSION_EXPIRED'
                ? '게스트 세션이 만료됐습니다.'
                : '학습 draft를 조회하려면 인증 정보가 필요합니다.',
            requestId,
            retryable: false
          })
        }
        const response = getStudyDraftAnswersResponseSchema.parse(
          mockDatabase.getCanonicalStudyDraft(
            parsedParams.data.sessionId,
            guest.id
          )
        )
        return HttpResponse.json(response, {
          headers: responseHeaders(requestId)
        })
      } catch (error: unknown) {
        return errorResponse(
          getStudyDraftAnswersErrorSchema,
          normalizedError(error, requestId, '학습 draft를 불러오지 못했습니다.')
        )
      }
    }
  ),
  http.put(
    '*/api/v1/study-sessions/:sessionId/draft-answers',
    async ({ params, request }) => {
      const requestId = crypto.randomUUID()
      if (!hasRequiredPracticeHeader(request)) {
        return errorResponse(saveStudyDraftAnswersErrorSchema, {
          code: 'INVALID_REQUEST',
          message: 'X-Nihongo-Practice-Contract: 2 header가 필요합니다.',
          requestId,
          retryable: false
        })
      }
      const parsedParams = saveStudyDraftAnswersParamsSchema.safeParse({
        sessionId: String(params.sessionId ?? '')
      })
      if (!parsedParams.success) {
        return errorResponse(saveStudyDraftAnswersErrorSchema, {
          code: 'INVALID_ID',
          message: '학습 세션 ID 형식이 올바르지 않습니다.',
          requestId,
          retryable: false
        })
      }
      const parsedHeaders = saveStudyDraftAnswersHeadersSchema.safeParse({
        'idempotency-key': request.headers.get('Idempotency-Key') ?? undefined,
        'x-nihongo-practice-contract':
          request.headers.get('X-Nihongo-Practice-Contract') ?? undefined
      })
      if (!parsedHeaders.success) {
        return errorResponse(saveStudyDraftAnswersErrorSchema, {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: '유효한 Idempotency-Key UUID header가 필요합니다.',
          requestId,
          retryable: false
        })
      }
      if (
        !JSON_CONTENT_TYPE_PATTERN.test(
          request.headers.get('Content-Type') ?? ''
        )
      ) {
        return errorResponse(saveStudyDraftAnswersErrorSchema, {
          code: 'INVALID_REQUEST',
          message: 'JSON 요청만 허용됩니다.',
          requestId,
          retryable: false
        })
      }
      if (!hasTrustedMockWriteOrigin(request)) {
        return errorResponse(saveStudyDraftAnswersErrorSchema, {
          code: 'UNTRUSTED_ORIGIN',
          message: '허용되지 않은 요청 출처입니다.',
          requestId,
          retryable: false
        })
      }
      try {
        const body = await parseSaveDraftBody(request)
        const guest = resolveGuestPrincipalId(request)
        if (guest.errorCode) {
          return errorResponse(saveStudyDraftAnswersErrorSchema, {
            code: guest.errorCode,
            message:
              guest.errorCode === 'GUEST_SESSION_EXPIRED'
                ? '게스트 세션이 만료됐습니다.'
                : '학습 draft를 저장하려면 인증 정보가 필요합니다.',
            requestId,
            retryable: false
          })
        }
        const saved = mockDatabase.saveCanonicalStudyDraft({
          body,
          guestPrincipalId: guest.id,
          idempotencyKey: parsedHeaders.data['idempotency-key'],
          sessionId: parsedParams.data.sessionId
        })
        const response = saveStudyDraftAnswersResponseSchema.parse(
          saved.response
        )
        return HttpResponse.json(response, {
          headers: {
            ...responseHeaders(requestId),
            ...(saved.replayed ? { 'Idempotency-Replayed': 'true' } : {})
          }
        })
      } catch (error: unknown) {
        const normalized = normalizedError(
          error,
          requestId,
          '학습 draft를 저장하지 못했습니다.'
        )
        return errorResponse(saveStudyDraftAnswersErrorSchema, normalized)
      }
    }
  ),
  http.post(
    '*/api/v1/study-sessions/:sessionId/cancellation',
    async ({ params, request }) => {
      const requestId = crypto.randomUUID()
      if (!hasRequiredPracticeHeader(request)) {
        return errorResponse(cancelStudySessionErrorSchema, {
          code: 'INVALID_REQUEST',
          message: 'X-Nihongo-Practice-Contract: 2 header가 필요합니다.',
          requestId,
          retryable: false
        })
      }
      const parsedParams = cancelStudySessionParamsSchema.safeParse({
        sessionId: String(params.sessionId ?? '')
      })
      if (!parsedParams.success) {
        return errorResponse(cancelStudySessionErrorSchema, {
          code: 'INVALID_ID',
          message: '학습 세션 ID 형식이 올바르지 않습니다.',
          requestId,
          retryable: false
        })
      }
      if (
        !JSON_CONTENT_TYPE_PATTERN.test(
          request.headers.get('Content-Type') ?? ''
        )
      ) {
        return errorResponse(cancelStudySessionErrorSchema, {
          code: 'INVALID_REQUEST',
          message: 'JSON 요청만 허용됩니다.',
          requestId,
          retryable: false
        })
      }
      if (!hasTrustedMockWriteOrigin(request)) {
        return errorResponse(cancelStudySessionErrorSchema, {
          code: 'UNTRUSTED_ORIGIN',
          message: '허용되지 않은 요청 출처입니다.',
          requestId,
          retryable: false
        })
      }
      try {
        await parseCancellationBody(request)
        const guest = resolveGuestPrincipalId(request)
        if (guest.errorCode) {
          return errorResponse(cancelStudySessionErrorSchema, {
            code: guest.errorCode,
            message:
              guest.errorCode === 'GUEST_SESSION_EXPIRED'
                ? '게스트 세션이 만료됐습니다.'
                : '학습 세션을 취소하려면 인증 정보가 필요합니다.',
            requestId,
            retryable: false
          })
        }
        mockDatabase.cancelCanonicalStudySession(
          parsedParams.data.sessionId,
          guest.id
        )
        return new HttpResponse(null, {
          status: 204,
          headers: responseHeaders(requestId)
        })
      } catch (error: unknown) {
        return errorResponse(
          cancelStudySessionErrorSchema,
          normalizedError(error, requestId, '학습 세션을 취소하지 못했습니다.')
        )
      }
    }
  )
]

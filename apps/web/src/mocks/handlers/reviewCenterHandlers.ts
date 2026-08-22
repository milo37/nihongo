import { errorStatusByCode } from '@nihongo/contracts/common/error'
import {
  createGetWrongNoteMemoResponseSchema,
  getWrongNoteMemoErrorSchema,
  getWrongNoteMemoParamsSchema,
  getWrongNoteMemoQuerySchema
} from '@nihongo/contracts/wrong-note/get-wrong-note-memo'
import {
  decodeReviewEventCursor,
  encodeReviewEventCursor,
  listReviewEventsErrorSchema,
  listReviewEventsParamsSchema,
  listReviewEventsQuerySchema,
  listReviewEventsResponseSchema
} from '@nihongo/contracts/wrong-note/list-review-events'
import {
  listReviewQueueErrorSchema,
  listReviewQueueQuerySchema,
  listReviewQueueResponseSchema
} from '@nihongo/contracts/wrong-note/list-review-queue'
import {
  createUpdateWrongNoteMemoResponseSchema,
  updateWrongNoteMemoBodySchema,
  updateWrongNoteMemoErrorSchema,
  updateWrongNoteMemoParamsSchema
} from '@nihongo/contracts/wrong-note/update-wrong-note-memo'
import { http, HttpResponse } from 'msw'
import type { ZodError, ZodIssue } from 'zod'
import {
  MockHttpError,
  parseSearchParams,
  readBoundedMockJsonObject
} from '@mocks/handlers/shared'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'

const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;|$)/iu
const MEMO_BODY_MAX_BYTES = 32 * 1_024
const RATE_WINDOW_MILLISECONDS = 60_000

interface ReviewCenterRateBucket {
  count: number
  windowStartedAt: number
}

class ReviewCenterRateLimitError extends MockHttpError {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super(
      429,
      'RATE_LIMITED',
      '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    )
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const reviewCenterRateBuckets = new Map<string, ReviewCenterRateBucket>()

const consumeReviewCenterRateLimit = (
  operation: string,
  maximum: number
): void => {
  const observedAt = Date.now()
  const existing = reviewCenterRateBuckets.get(operation)
  if (
    !existing ||
    observedAt < existing.windowStartedAt ||
    observedAt - existing.windowStartedAt >= RATE_WINDOW_MILLISECONDS
  ) {
    reviewCenterRateBuckets.set(operation, {
      count: 1,
      windowStartedAt: observedAt
    })
    return
  }
  if (existing.count >= maximum) {
    throw new ReviewCenterRateLimitError(
      Math.max(
        1,
        Math.ceil(
          (existing.windowStartedAt + RATE_WINDOW_MILLISECONDS - observedAt) /
            1_000
        )
      )
    )
  }
  existing.count += 1
}

const hasTrustedReviewCenterWriteOrigin = (request: Request): boolean => {
  const origin = request.headers.get('Origin')
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  const applicationOrigin = globalThis.location?.origin
  return (
    (origin !== null &&
      applicationOrigin !== undefined &&
      origin === applicationOrigin) ||
    (origin === null && fetchSite === 'same-origin')
  )
}

interface ReviewCenterErrorPayload {
  code: keyof typeof errorStatusByCode
  fieldErrors?: Record<string, string[]>
  message: string
  requestId: string
  retryAfterSeconds?: number
  retryable: boolean
}

const responseHeaders = (
  requestId: string,
  code?: ReviewCenterErrorPayload['code'],
  retryAfterSeconds?: number
): Record<string, string> => ({
  'Cache-Control': 'private, no-store',
  'X-Request-Id': requestId,
  ...(code === 'RATE_LIMITED'
    ? { 'Retry-After': String(retryAfterSeconds ?? 60) }
    : code === 'SERVICE_UNAVAILABLE'
      ? { 'Retry-After': '5' }
      : {})
})

const errorResponse = (
  schema: { parse: (value: unknown) => ReviewCenterErrorPayload },
  payload: ReviewCenterErrorPayload
): HttpResponse<ReviewCenterErrorPayload> => {
  const { retryAfterSeconds, ...wirePayload } = payload
  const parsed = schema.parse(wirePayload)
  return HttpResponse.json(parsed, {
    status: errorStatusByCode[parsed.code],
    headers: responseHeaders(parsed.requestId, parsed.code, retryAfterSeconds)
  })
}

const requireUserId = (message: string): string => {
  const user = mockDatabase.getCurrentUser()
  if (!user) {
    throw new MockDatabaseError('AUTH_REQUIRED', 401, message)
  }
  return user.id
}

const normalizeError = (
  error: unknown,
  requestId: string,
  fallbackMessage: string,
  notFoundMessage?: string
): ReviewCenterErrorPayload => {
  if (error instanceof MockHttpError) {
    return {
      code: error.code as ReviewCenterErrorPayload['code'],
      message: error.message,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      requestId,
      ...(error instanceof ReviewCenterRateLimitError
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
      retryable: error.code === 'RATE_LIMITED'
    }
  }
  if (error instanceof MockDatabaseError) {
    if (error.code === 'AUTH_REQUIRED') {
      return {
        code: 'AUTHENTICATION_REQUIRED',
        message: error.message,
        requestId,
        retryable: false
      }
    }
    if (
      notFoundMessage &&
      (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')
    ) {
      return {
        code: 'RESOURCE_NOT_FOUND',
        message: notFoundMessage,
        requestId,
        retryable: false
      }
    }
  }

  console.error('Mock review center request failed')
  return {
    code: 'INTERNAL_SERVER_ERROR',
    message: fallbackMessage,
    requestId,
    retryable: true
  }
}

const invalidQuestionId = (
  schema: { parse: (value: unknown) => ReviewCenterErrorPayload },
  requestId: string,
  error: ZodError
): HttpResponse<ReviewCenterErrorPayload> =>
  errorResponse(schema, {
    code: 'INVALID_ID',
    fieldErrors: toFieldErrors(error),
    message: '문제 ID 형식이 올바르지 않습니다.',
    requestId,
    retryable: false
  })

const toFieldErrors = (error: ZodError): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {}
  error.issues.forEach((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request'
    fieldErrors[path] = [...(fieldErrors[path] ?? []), issue.message]
  })
  return fieldErrors
}

const containsCustomIssue = (issue: ZodIssue): boolean => {
  if (issue.code === 'custom') {
    return true
  }
  if (issue.code === 'invalid_union') {
    return issue.errors.some((branch) => branch.some(containsCustomIssue))
  }
  if (issue.code === 'invalid_key' || issue.code === 'invalid_element') {
    return issue.issues.some(containsCustomIssue)
  }
  return false
}

const memoBodyError = (error: ZodError): MockHttpError => {
  const isSemanticMemoError = error.issues.some(
    (issue) => issue.path[0] === 'memo' && containsCustomIssue(issue)
  )
  return new MockHttpError(
    isSemanticMemoError ? 422 : 400,
    isSemanticMemoError ? 'VALIDATION_ERROR' : 'INVALID_REQUEST',
    isSemanticMemoError
      ? '오답 메모 내용이 올바르지 않습니다.'
      : '오답 메모 요청 형식이 올바르지 않습니다.',
    toFieldErrors(error)
  )
}

export const reviewCenterHandlers = [
  http.get('*/api/v1/review-queue', ({ request }) => {
    const requestId = crypto.randomUUID()
    try {
      consumeReviewCenterRateLimit('wrong-note-review-queue', 120)
      const query = parseSearchParams(
        request,
        listReviewQueueQuerySchema,
        '복습 대기열 조회 조건이 올바르지 않습니다.'
      )
      const userId = requireUserId(
        '복습 대기열을 조회하려면 로그인이 필요합니다.'
      )
      const response = listReviewQueueResponseSchema.parse(
        mockDatabase.listCanonicalReviewQueue(userId, query)
      )
      return HttpResponse.json(response, {
        headers: responseHeaders(requestId)
      })
    } catch (error: unknown) {
      return errorResponse(
        listReviewQueueErrorSchema,
        normalizeError(error, requestId, '복습 대기열을 불러오지 못했습니다.')
      )
    }
  }),
  http.get('*/api/v1/wrong-notes/:questionId/memo', ({ params, request }) => {
    const requestId = crypto.randomUUID()
    try {
      consumeReviewCenterRateLimit('wrong-note-memo-read', 120)
      const parsedParams = getWrongNoteMemoParamsSchema.safeParse({
        questionId: String(params.questionId ?? '')
      })
      if (!parsedParams.success) {
        return invalidQuestionId(
          getWrongNoteMemoErrorSchema,
          requestId,
          parsedParams.error
        )
      }
      parseSearchParams(
        request,
        getWrongNoteMemoQuerySchema,
        '오답 메모 조회 조건이 올바르지 않습니다.'
      )
      const userId = requireUserId(
        '오답 노트를 조회하려면 로그인이 필요합니다.'
      )
      const response = createGetWrongNoteMemoResponseSchema(
        parsedParams.data.questionId
      ).parse(
        mockDatabase.getCanonicalUserMemo(userId, parsedParams.data.questionId)
      )
      return HttpResponse.json(response, {
        headers: responseHeaders(requestId)
      })
    } catch (error: unknown) {
      return errorResponse(
        getWrongNoteMemoErrorSchema,
        normalizeError(
          error,
          requestId,
          '오답 메모를 불러오지 못했습니다.',
          '오답 노트를 찾을 수 없습니다.'
        )
      )
    }
  }),
  http.put(
    '*/api/v1/wrong-notes/:questionId/memo',
    async ({ params, request }) => {
      const requestId = crypto.randomUUID()
      try {
        if (
          !JSON_CONTENT_TYPE_PATTERN.test(
            request.headers.get('Content-Type') ?? ''
          )
        ) {
          throw new MockHttpError(
            400,
            'INVALID_REQUEST',
            'JSON 요청만 허용됩니다.'
          )
        }
        if (!hasTrustedReviewCenterWriteOrigin(request)) {
          throw new MockHttpError(
            403,
            'UNTRUSTED_ORIGIN',
            '허용되지 않은 요청 출처입니다.'
          )
        }
        consumeReviewCenterRateLimit('wrong-note-memo-write', 60)
        const parsedParams = updateWrongNoteMemoParamsSchema.safeParse({
          questionId: String(params.questionId ?? '')
        })
        if (!parsedParams.success) {
          return invalidQuestionId(
            updateWrongNoteMemoErrorSchema,
            requestId,
            parsedParams.error
          )
        }
        parseSearchParams(
          request,
          getWrongNoteMemoQuerySchema,
          '오답 메모 수정 조건이 올바르지 않습니다.'
        )
        const rawBody = await readBoundedMockJsonObject(
          request,
          MEMO_BODY_MAX_BYTES
        )
        const parsedBody = updateWrongNoteMemoBodySchema.safeParse(rawBody)
        if (!parsedBody.success) {
          throw memoBodyError(parsedBody.error)
        }
        const userId = requireUserId(
          '오답 노트를 조회하려면 로그인이 필요합니다.'
        )
        const response = createUpdateWrongNoteMemoResponseSchema(
          parsedParams.data.questionId
        ).parse(
          mockDatabase.updateCanonicalUserMemo(
            userId,
            parsedParams.data.questionId,
            parsedBody.data.memo
          )
        )
        return HttpResponse.json(response, {
          headers: responseHeaders(requestId)
        })
      } catch (error: unknown) {
        return errorResponse(
          updateWrongNoteMemoErrorSchema,
          normalizeError(
            error,
            requestId,
            '오답 메모를 저장하지 못했습니다.',
            '오답 노트를 찾을 수 없습니다.'
          )
        )
      }
    }
  ),
  http.get(
    '*/api/v1/wrong-notes/:questionId/review-events',
    ({ params, request }) => {
      const requestId = crypto.randomUUID()
      try {
        consumeReviewCenterRateLimit('wrong-note-history', 120)
        const parsedParams = listReviewEventsParamsSchema.safeParse({
          questionId: String(params.questionId ?? '')
        })
        if (!parsedParams.success) {
          return invalidQuestionId(
            listReviewEventsErrorSchema,
            requestId,
            parsedParams.error
          )
        }
        const query = parseSearchParams(
          request,
          listReviewEventsQuerySchema,
          '복습 기록 조회 조건이 올바르지 않습니다.'
        )
        const userId = requireUserId(
          '오답 노트를 조회하려면 로그인이 필요합니다.'
        )
        const cursor = query.cursor
          ? decodeReviewEventCursor(query.cursor)
          : null
        const candidates = mockDatabase
          .listCanonicalReviewEvents(userId, parsedParams.data.questionId)
          .filter(
            (event) =>
              cursor === null ||
              event.occurredAt < cursor.occurredAt ||
              (event.occurredAt === cursor.occurredAt && event.id < cursor.id)
          )
        const visible = candidates.slice(0, query.pageSize)
        const hasMore = candidates.length > query.pageSize
        const last = visible.at(-1)
        const response = listReviewEventsResponseSchema.parse({
          items: visible,
          nextCursor:
            hasMore && last
              ? encodeReviewEventCursor({
                  v: 1,
                  occurredAt: last.occurredAt,
                  id: last.id
                })
              : null
        })
        return HttpResponse.json(response, {
          headers: responseHeaders(requestId)
        })
      } catch (error: unknown) {
        return errorResponse(
          listReviewEventsErrorSchema,
          normalizeError(
            error,
            requestId,
            '복습 기록을 불러오지 못했습니다.',
            '오답 노트를 찾을 수 없습니다.'
          )
        )
      }
    }
  )
]

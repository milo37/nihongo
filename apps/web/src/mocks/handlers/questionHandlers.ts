import { http, HttpResponse } from 'msw'
import {
  getQuestionErrorSchema,
  getQuestionParamsSchema,
  getQuestionResponseSchema,
  type GetQuestionError
} from '@nihongo/contracts/question/get-question'
import {
  listQuestionsErrorSchema,
  listQuestionsQuerySchema,
  listQuestionsResponseSchema,
  type ListQuestionsError,
  type ParsedListQuestionsQuery
} from '@nihongo/contracts/question/list-questions'
import {
  getPhase7QuestionContractIdentity,
  getQuestionVersionFingerprint,
  toContractPracticeQuestion,
  toContractQuestionSummary
} from '@mocks/adapters/questionContractAdapter'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'
import { MockHttpError, parseSearchParams } from '@mocks/handlers/shared'

export type QuestionReadOperation =
  | 'question-list-read'
  | 'question-detail-read'

const QUESTION_READ_IDENTITY = 'canonical-mock-question-client'
const QUESTION_READ_RATE_LIMIT_MAX = 120
const QUESTION_READ_RATE_WINDOW_MILLISECONDS = 60_000

interface QuestionReadRateBucket {
  count: number
  windowStartedAt: number
}

class QuestionReadRateLimitError extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.')
    this.name = 'QuestionReadRateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const questionReadRateBuckets = new Map<string, QuestionReadRateBucket>()

export const resetQuestionReadRateLimitForTesting = (): void => {
  questionReadRateBuckets.clear()
}

export const primeQuestionReadRateLimitForTesting = (
  operation: QuestionReadOperation,
  count: number
): void => {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > QUESTION_READ_RATE_LIMIT_MAX
  ) {
    throw new Error('question read rate count가 올바르지 않습니다.')
  }
  questionReadRateBuckets.set(`${operation}:${QUESTION_READ_IDENTITY}`, {
    count,
    windowStartedAt: Date.now()
  })
}

const consumeQuestionReadRateLimit = (
  operation: QuestionReadOperation
): void => {
  const observedAt = Date.now()
  const key = `${operation}:${QUESTION_READ_IDENTITY}`
  const previous = questionReadRateBuckets.get(key)

  if (
    !previous ||
    observedAt < previous.windowStartedAt ||
    observedAt - previous.windowStartedAt >=
      QUESTION_READ_RATE_WINDOW_MILLISECONDS
  ) {
    questionReadRateBuckets.set(key, {
      count: 1,
      windowStartedAt: observedAt
    })
    return
  }

  const next = {
    count: previous.count + 1,
    windowStartedAt: previous.windowStartedAt
  }
  questionReadRateBuckets.set(key, next)
  if (next.count > QUESTION_READ_RATE_LIMIT_MAX) {
    throw new QuestionReadRateLimitError(
      Math.max(
        1,
        Math.ceil(
          (next.windowStartedAt +
            QUESTION_READ_RATE_WINDOW_MILLISECONDS -
            observedAt) /
            1_000
        )
      )
    )
  }
}

const getErrorStatus = (code: string): number =>
  code === 'INVALID_ID' || code === 'VALIDATION_ERROR'
    ? 422
    : code === 'RESOURCE_NOT_FOUND'
      ? 404
      : code === 'RATE_LIMITED'
        ? 429
        : code === 'SERVICE_UNAVAILABLE'
          ? 503
          : 500

const getErrorHeaders = (
  code: string,
  requestId: string,
  retryAfterSeconds?: number
): Record<string, string> => ({
  'Cache-Control': 'private, no-store',
  'X-Request-Id': requestId,
  ...(code === 'RATE_LIMITED' && retryAfterSeconds !== undefined
    ? { 'Retry-After': String(retryAfterSeconds) }
    : code === 'SERVICE_UNAVAILABLE'
      ? { 'Retry-After': '5' }
      : {})
})

const createQuestionErrorResponse = (
  error: GetQuestionError,
  retryAfterSeconds?: number
): HttpResponse<GetQuestionError> => {
  const payload = getQuestionErrorSchema.parse(error)

  return HttpResponse.json(payload, {
    status: getErrorStatus(payload.code),
    headers: getErrorHeaders(payload.code, payload.requestId, retryAfterSeconds)
  })
}

const createListQuestionsErrorResponse = (
  error: ListQuestionsError,
  retryAfterSeconds?: number
): HttpResponse<ListQuestionsError> => {
  const payload = listQuestionsErrorSchema.parse(error)

  return HttpResponse.json(payload, {
    status: getErrorStatus(payload.code),
    headers: getErrorHeaders(payload.code, payload.requestId, retryAfterSeconds)
  })
}

const listAllPublishedQuestions = (query: ParsedListQuestionsQuery) => {
  const filters = {
    ...(query.level ? { level: query.level } : {}),
    ...(query.subject ? { subject: query.subject } : {}),
    ...(query.type ? { questionType: query.type } : {}),
    ...(query.difficulty ? { difficulty: query.difficulty } : {}),
    ...(query.tag ? { tag: query.tag } : {})
  }
  return mockDatabase.listCanonicalPublicQuestionRecords(filters)
}

export const questionHandlers = [
  http.get('*/api/v1/questions', ({ request }) => {
    const requestId = crypto.randomUUID()

    try {
      consumeQuestionReadRateLimit('question-list-read')
      const query = parseSearchParams(request, listQuestionsQuerySchema)
      const summaries = listAllPublishedQuestions(query)
        .map(toContractQuestionSummary)
        .toSorted((left, right) => left.id.localeCompare(right.id))
      const start = (query.page - 1) * query.pageSize
      const response = listQuestionsResponseSchema.parse({
        items: summaries.slice(start, start + query.pageSize),
        page: query.page,
        pageSize: query.pageSize,
        total: summaries.length
      })

      return HttpResponse.json(response, {
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Request-Id': requestId
        }
      })
    } catch (error: unknown) {
      if (error instanceof QuestionReadRateLimitError) {
        return createListQuestionsErrorResponse(
          {
            code: 'RATE_LIMITED',
            message: error.message,
            requestId,
            retryable: true
          },
          error.retryAfterSeconds
        )
      }
      if (error instanceof MockHttpError) {
        return createListQuestionsErrorResponse({
          code: 'VALIDATION_ERROR',
          message: error.message,
          requestId,
          retryable: false
        })
      }

      console.error('Mock v1 listQuestions response failed validation', error)

      return createListQuestionsErrorResponse({
        code: 'INTERNAL_SERVER_ERROR',
        message: '요청을 처리하지 못했습니다.',
        requestId,
        retryable: true
      })
    }
  }),
  http.get('*/api/v1/questions/:questionId', ({ params }) => {
    const requestId = crypto.randomUUID()

    try {
      consumeQuestionReadRateLimit('question-detail-read')
      const parsedParams = getQuestionParamsSchema.safeParse({
        questionId: String(params.questionId ?? '')
      })

      if (!parsedParams.success) {
        return createQuestionErrorResponse({
          code: 'INVALID_ID',
          message: '문제 ID 형식이 올바르지 않습니다.',
          requestId,
          retryable: false
        })
      }

      const sourceQuestion = mockDatabase.getCanonicalPublicQuestionRecord(
        parsedParams.data.questionId
      )
      const response = getQuestionResponseSchema.parse(
        toContractPracticeQuestion(
          sourceQuestion,
          getQuestionVersionFingerprint(sourceQuestion),
          getPhase7QuestionContractIdentity(sourceQuestion)
        )
      )

      return HttpResponse.json(response, {
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Request-Id': requestId
        }
      })
    } catch (error: unknown) {
      if (error instanceof QuestionReadRateLimitError) {
        return createQuestionErrorResponse(
          {
            code: 'RATE_LIMITED',
            message: error.message,
            requestId,
            retryable: true
          },
          error.retryAfterSeconds
        )
      }
      if (error instanceof MockDatabaseError && error.status === 404) {
        return createQuestionErrorResponse({
          code: 'RESOURCE_NOT_FOUND',
          message: '문제를 찾을 수 없습니다.',
          requestId,
          retryable: false
        })
      }

      console.error('Mock v1 getQuestion response failed validation', error)

      return createQuestionErrorResponse({
        code: 'INTERNAL_SERVER_ERROR',
        message: '요청을 처리하지 못했습니다.',
        requestId,
        retryable: true
      })
    }
  })
]

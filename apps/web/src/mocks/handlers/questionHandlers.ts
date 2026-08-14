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
  getQuestionVersionFingerprint,
  getSourceQuestionId,
  toContractPracticeQuestion,
  toContractQuestionSummary
} from '@mocks/adapters/questionContractAdapter'
import { MockDatabaseError, mockDatabase } from '@mocks/repository/mockDatabase'
import { MockHttpError, parseSearchParams } from '@mocks/handlers/shared'

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
  requestId: string
): Record<string, string> => ({
  'Cache-Control': 'private, no-store',
  'X-Request-Id': requestId,
  ...(code === 'RATE_LIMITED'
    ? { 'Retry-After': '30' }
    : code === 'SERVICE_UNAVAILABLE'
      ? { 'Retry-After': '5' }
      : {})
})

const createQuestionErrorResponse = (
  error: GetQuestionError
): HttpResponse<GetQuestionError> => {
  const payload = getQuestionErrorSchema.parse(error)

  return HttpResponse.json(payload, {
    status: getErrorStatus(payload.code),
    headers: getErrorHeaders(payload.code, payload.requestId)
  })
}

const createListQuestionsErrorResponse = (
  error: ListQuestionsError
): HttpResponse<ListQuestionsError> => {
  const payload = listQuestionsErrorSchema.parse(error)

  return HttpResponse.json(payload, {
    status: getErrorStatus(payload.code),
    headers: getErrorHeaders(payload.code, payload.requestId)
  })
}

const listRuntimeQuestionIdentities = (): Array<{ id: string }> => {
  const pageSize = 100
  const firstPage = mockDatabase.listAdminQuestions({ page: 1, pageSize })
  const identities = firstPage.items.map(({ id }) => ({ id }))
  let page = 2

  while (identities.length < firstPage.total) {
    const result = mockDatabase.listAdminQuestions({ page, pageSize })

    if (result.items.length === 0) {
      break
    }

    identities.push(...result.items.map(({ id }) => ({ id })))
    page += 1
  }

  return identities
}

const listAllPublishedQuestions = (query: ParsedListQuestionsQuery) => {
  const pageSize = 100
  const filters = {
    ...(query.level ? { level: query.level } : {}),
    ...(query.subject ? { subject: query.subject } : {}),
    ...(query.type ? { questionType: query.type } : {}),
    ...(query.difficulty ? { difficulty: query.difficulty } : {}),
    ...(query.tag ? { tag: query.tag } : {})
  }
  const firstPage = mockDatabase.listQuestions({
    ...filters,
    page: 1,
    pageSize
  })
  const questions = firstPage.items.map(({ id }) =>
    mockDatabase.getQuestion(id)
  )
  let page = 2

  while (questions.length < firstPage.total) {
    const result = mockDatabase.listQuestions({
      ...filters,
      page,
      pageSize
    })

    if (result.items.length === 0) {
      break
    }

    questions.push(
      ...result.items.map(({ id }) => mockDatabase.getQuestion(id))
    )
    page += 1
  }

  return questions
}

export const questionHandlers = [
  http.get('*/api/v1/questions', ({ request }) => {
    const requestId = crypto.randomUUID()

    try {
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

    try {
      const sourceQuestionId = getSourceQuestionId(
        parsedParams.data.questionId,
        listRuntimeQuestionIdentities()
      )

      if (!sourceQuestionId) {
        return createQuestionErrorResponse({
          code: 'RESOURCE_NOT_FOUND',
          message: '문제를 찾을 수 없습니다.',
          requestId,
          retryable: false
        })
      }

      const sourceQuestion = mockDatabase.getQuestion(sourceQuestionId)
      const response = getQuestionResponseSchema.parse(
        toContractPracticeQuestion(
          mockDatabase.getPracticeQuestion(sourceQuestionId),
          getQuestionVersionFingerprint(sourceQuestion)
        )
      )

      return HttpResponse.json(response, {
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Request-Id': requestId
        }
      })
    } catch (error: unknown) {
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

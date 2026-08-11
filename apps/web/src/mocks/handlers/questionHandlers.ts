import { http, HttpResponse } from 'msw'
import { listQuestionRequestSchema } from '@api/question/listQuestion/schema'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { parseSearchParams, toErrorResponse } from '@mocks/handlers/shared'

export const questionHandlers = [
  http.get('*/api/question', ({ request }) => {
    try {
      const params = parseSearchParams(request, listQuestionRequestSchema)
      return HttpResponse.json(mockDatabase.listQuestions(params))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.get('*/api/question/:questionId', ({ params }) => {
    try {
      const questionId = String(params.questionId ?? '')
      return HttpResponse.json(mockDatabase.getPracticeQuestion(questionId))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })
]

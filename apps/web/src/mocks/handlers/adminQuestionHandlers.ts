import type { User } from '@common/types/domain'
import { http, HttpResponse } from 'msw'
import { createAdminQuestionRequestSchema } from '@api/admin-question/createAdminQuestion/schema'
import { listAdminQuestionRequestSchema } from '@api/admin-question/listAdminQuestion/schema'
import { updateAdminQuestionRequestSchema } from '@api/admin-question/updateAdminQuestion/schema'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import {
  MockHttpError,
  parseJsonBody,
  parseSearchParams,
  toErrorResponse
} from '@mocks/handlers/shared'

const requireAdmin = (): User => {
  const user = mockDatabase.getCurrentUser()

  if (!user) {
    throw new MockHttpError(
      401,
      'AUTHENTICATION_REQUIRED',
      '로그인이 필요한 기능입니다.'
    )
  }

  if (user.role !== 'ADMIN') {
    throw new MockHttpError(403, 'ADMIN_REQUIRED', '관리자 권한이 필요합니다.')
  }

  return user
}

export const adminQuestionHandlers = [
  http.get('*/api/admin/question', ({ request }) => {
    try {
      requireAdmin()
      const params = parseSearchParams(request, listAdminQuestionRequestSchema)
      return HttpResponse.json(mockDatabase.listAdminQuestions(params))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.get('*/api/admin/question/:questionId', ({ params }) => {
    try {
      requireAdmin()
      const questionId = String(params.questionId ?? '')
      return HttpResponse.json(mockDatabase.getAdminQuestion(questionId))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.post('*/api/admin/question', async ({ request }) => {
    try {
      requireAdmin()
      const input = await parseJsonBody(
        request,
        createAdminQuestionRequestSchema
      )
      return HttpResponse.json(mockDatabase.createQuestion(input), {
        status: 201
      })
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.put('*/api/admin/question/:questionId', async ({ params, request }) => {
    try {
      requireAdmin()
      const questionId = String(params.questionId ?? '')
      const input = await parseJsonBody(
        request,
        updateAdminQuestionRequestSchema
      )

      return HttpResponse.json(mockDatabase.updateQuestion(questionId, input))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.delete('*/api/admin/question/:questionId', ({ params }) => {
    try {
      requireAdmin()
      const questionId = String(params.questionId ?? '')
      mockDatabase.deleteQuestion(questionId)

      return HttpResponse.json({ success: true as const, questionId })
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })
]

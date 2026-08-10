import type { User } from '@common/types/domain'
import { http, HttpResponse } from 'msw'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { MockHttpError, toErrorResponse } from '@mocks/handlers/shared'

const requireAuthenticatedUser = (): User => {
  const user = mockDatabase.getCurrentUser()

  if (!user) {
    throw new MockHttpError(
      401,
      'AUTHENTICATION_REQUIRED',
      '로그인이 필요한 기능입니다.'
    )
  }

  return user
}

export const bookmarkHandlers = [
  http.get('*/api/bookmark', () => {
    try {
      const user = requireAuthenticatedUser()
      return HttpResponse.json(mockDatabase.listBookmarks(user.id))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.post('*/api/bookmark/:questionId', ({ params }) => {
    try {
      const user = requireAuthenticatedUser()
      const questionId = String(params.questionId ?? '')
      return HttpResponse.json(mockDatabase.createBookmark(user.id, questionId))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.delete('*/api/bookmark/:questionId', ({ params }) => {
    try {
      const user = requireAuthenticatedUser()
      const questionId = String(params.questionId ?? '')
      mockDatabase.deleteBookmark(user.id, questionId)

      return HttpResponse.json({ success: true as const, questionId })
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })
]

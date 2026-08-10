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

export const dashboardHandlers = [
  http.get('*/api/dashboard/stats', () => {
    try {
      const user = requireAuthenticatedUser()
      return HttpResponse.json(mockDatabase.getDashboardStats(user.id))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })
]

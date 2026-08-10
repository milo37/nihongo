import { http, HttpResponse } from 'msw'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { toErrorResponse } from '@mocks/handlers/shared'

export const authHandlers = [
  http.get('*/api/auth/current-user', () => {
    try {
      return HttpResponse.json(mockDatabase.getCurrentUser())
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.post('*/api/auth/login/user', () => {
    try {
      return HttpResponse.json(mockDatabase.loginAs('USER'))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.post('*/api/auth/login/admin', () => {
    try {
      return HttpResponse.json(mockDatabase.loginAs('ADMIN'))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.post('*/api/auth/logout', () => {
    try {
      mockDatabase.logout()
      return HttpResponse.json({ success: true as const })
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })
]

import { http, HttpResponse } from 'msw'
import { worker } from '@mocks/browser'
import { DEMO_ADMIN_ID, DEMO_USER_ID } from '@mocks/data/users'
import { setMockSsoAccountForTesting } from '@mocks/handlers/authHandlers'

const createDashboardStatsFailure = () =>
  http.get(
    '*/api/v1/dashboard',
    () => {
      const requestId = crypto.randomUUID()
      return HttpResponse.json(
        {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Dashboard stats browser fault injection',
          requestId,
          retryable: true
        },
        {
          status: 503,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Nihongo-Test-Fault': 'dashboard-stats-503',
            'X-Request-Id': requestId
          }
        }
      )
    },
    { once: true }
  )

export const armAccessibilityDashboardStatsFailure = (): void => {
  // QueryClient retries one retryable 5xx response. Two one-shot failures leave
  // a stable cached-data error state; the explicit UI retry then reaches the
  // canonical handler again.
  worker.use(createDashboardStatsFailure(), createDashboardStatsFailure())
}

export const selectAccessibilityMockActor = (role: 'ADMIN' | 'USER') => {
  if (__NIHONGO_API_MODE__ !== 'mock' || import.meta.env.MODE !== 'test') {
    throw new Error('Accessibility actor selection requires Mock test mode.')
  }
  const id = role === 'ADMIN' ? DEMO_ADMIN_ID : DEMO_USER_ID
  setMockSsoAccountForTesting('google', id)
  return { id, role }
}

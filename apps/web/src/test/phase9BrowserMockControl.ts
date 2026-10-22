import { http, HttpResponse } from 'msw'
import { worker } from '@mocks/browser'

const createDashboardInsightsFailure = () =>
  http.get(
    '*/api/v1/dashboard/insights',
    () => {
      const requestId = crypto.randomUUID()
      return HttpResponse.json(
        {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Phase 9 browser fault injection',
          requestId,
          retryable: true
        },
        {
          status: 503,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Phase9-Test-Fault': 'dashboard-insights-503',
            'X-Request-Id': requestId
          }
        }
      )
    },
    { once: true }
  )

export const armPhase9DashboardInsightsFailure = (): void => {
  // QueryClient retries one retryable 5xx response. Two one-shot failures leave
  // a stable cached-data error state; the explicit UI retry then reaches the
  // canonical handler again.
  worker.use(createDashboardInsightsFailure(), createDashboardInsightsFailure())
}

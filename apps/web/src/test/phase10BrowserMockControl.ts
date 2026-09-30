import { delay, http, HttpResponse } from 'msw'
import { worker } from '@mocks/browser'

export type Phase10DashboardFault = 'malformed' | 'network' | 'rate-limit'

const dashboardInsightsPath = '*/api/v1/dashboard/insights'
let resetAdminUpdateRaceBarrier = (): void => undefined

const createRateLimitFailure = () =>
  http.get(
    dashboardInsightsPath,
    () => {
      const requestId = crypto.randomUUID()
      return HttpResponse.json(
        {
          code: 'RATE_LIMITED',
          message: 'Phase 10 browser rate-limit fault injection',
          requestId,
          retryable: true
        },
        {
          status: 429,
          headers: {
            'Cache-Control': 'private, no-store',
            'Retry-After': '0',
            'X-Phase10-Test-Fault': 'dashboard-insights-429',
            'X-Request-Id': requestId
          }
        }
      )
    },
    { once: true }
  )

export const armPhase10DashboardInsightsFault = (
  fault: Phase10DashboardFault
): void => {
  if (fault === 'network') {
    worker.use(
      http.get(dashboardInsightsPath, () => HttpResponse.error(), {
        once: true
      }),
      http.get(dashboardInsightsPath, () => HttpResponse.error(), {
        once: true
      })
    )
    return
  }

  if (fault === 'rate-limit') {
    worker.use(
      createRateLimitFailure(),
      createRateLimitFailure(),
      createRateLimitFailure()
    )
    return
  }

  worker.use(
    http.get(
      dashboardInsightsPath,
      () =>
        HttpResponse.json(
          { malformed: true },
          {
            headers: {
              'Cache-Control': 'private, no-store',
              'X-Phase10-Test-Fault': 'dashboard-insights-malformed'
            }
          }
        ),
      { once: true }
    )
  )
}

export const armPhase10AdminUpdateRaceBarrier = (versionId: string): void => {
  resetAdminUpdateRaceBarrier()
  resetAdminUpdateRaceBarrier = (): void => {
    worker.resetHandlers()
    resetAdminUpdateRaceBarrier = (): void => undefined
  }
  worker.use(
    http.patch(
      `*/api/v1/admin/question-versions/${versionId}`,
      async () => {
        await delay(1_000)
        return undefined
      },
      { once: true }
    )
  )
}

export const disarmPhase10AdminUpdateRaceBarrier = (): void => {
  resetAdminUpdateRaceBarrier()
}

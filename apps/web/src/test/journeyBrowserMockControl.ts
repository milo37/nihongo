import { http, HttpResponse } from 'msw'
import { getCurrentPrincipalResponseSchema } from '@nihongo/contracts/auth/get-current-principal'
import { worker } from '@mocks/browser'
import {
  resetMockSocialSignInForTesting,
  setMockSsoAccountForTesting
} from '@mocks/handlers/authHandlers'
import {
  DEMO_ADMIN_ID,
  DEMO_REVIEWER_ADMIN_ID,
  DEMO_USER_ID
} from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { queryClient } from '@nihongo/browser/libs/queryClient'

const assertMockTestMode = (): void => {
  if (__NIHONGO_API_MODE__ !== 'mock' || import.meta.env.MODE !== 'test') {
    throw new Error('Phase 10 Mock control requires Mock test mode.')
  }
}

export const resetPhase10MockState = async (): Promise<void> => {
  assertMockTestMode()
  await queryClient.cancelQueries()
  worker.resetHandlers()
  resetMockSocialSignInForTesting()
  mockDatabase.reset()
  queryClient.clear()
}

export const completePhase10MockGoogleCallback = async (): Promise<void> => {
  assertMockTestMode()
  const response = await fetch('/api/_mock/auth/social/callback', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google' })
  })
  if (!response.ok) throw new Error('Mock Google callback was not accepted.')
  const principal = getCurrentPrincipalResponseSchema.parse(
    await response.json()
  )
  if (principal.kind !== 'USER' || principal.user.role !== 'USER') {
    throw new Error('Mock Google callback did not confirm a USER.')
  }
}

const phase78ActorIds = {
  author: DEMO_ADMIN_ID,
  reviewer: DEMO_REVIEWER_ADMIN_ID,
  learner: DEMO_USER_ID,
  insightsLearner: DEMO_USER_ID
} as const
export type Phase78MockActor = keyof typeof phase78ActorIds

export const selectPhase78MockGoogleActor = (actor: Phase78MockActor): void => {
  assertMockTestMode()
  setMockSsoAccountForTesting('google', phase78ActorIds[actor])
}

export const completePhase78MockGoogleCallback = async (
  actor: Phase78MockActor
): Promise<void> => {
  assertMockTestMode()
  const response = await fetch('/api/_mock/auth/social/callback', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google' })
  })
  if (!response.ok) throw new Error('Mock actor callback was not accepted.')
  const principal = getCurrentPrincipalResponseSchema.parse(
    await response.json()
  )
  const role = actor === 'author' || actor === 'reviewer' ? 'ADMIN' : 'USER'
  if (
    principal.kind !== 'USER' ||
    principal.user.role !== role ||
    principal.user.id !== phase78ActorIds[actor]
  ) {
    throw new Error('Mock callback did not confirm the selected actor.')
  }
}

export type Phase10DashboardFault = 'malformed' | 'network' | 'rate-limit'

const dashboardInsightsPath = '*/api/v1/dashboard/insights'

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
  assertMockTestMode()
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

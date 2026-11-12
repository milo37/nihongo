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
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { useAppStore } from '@nihongo/browser/store/index'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { mockGuestAllowance } from '@mocks/handlers/guestAllowanceHandlers'

const assertMockTestMode = (): void => {
  if (__NIHONGO_API_MODE__ !== 'mock' || import.meta.env.MODE !== 'test') {
    throw new Error('Journey Mock control requires Mock test mode.')
  }
}

export const resetJourneyMockState = async (): Promise<void> => {
  assertMockTestMode()
  await queryClient.cancelQueries()
  worker.resetHandlers()
  resetMockSocialSignInForTesting()
  mockDatabase.reset()
  mockGuestAllowance.reset()
  queryClient.clear()
}

// JLP-853: My page counts only the target level. The Mock learner's seed
// target is N2, so a journey that studies N5 aligns it here. No request is
// made, and the Mock keeps this only until the next page load.
export const setJourneyLearnerTargetLevel = (level: JlptLevel): void => {
  assertMockTestMode()
  const user = mockDatabase.getCurrentUser()
  const current = useAppStore.getState().currentUser
  if (!user || !current || current.id !== user.id) {
    throw new Error('Journey Mock learner is not signed in.')
  }
  mockDatabase.setTargetLevel(user.id, level)
  // Screens read the user from the cached /me answer and the store.
  queryClient.setQueryData(authQueries.currentUser().queryKey, (cached) =>
    cached ? { ...cached, targetLevel: level } : cached
  )
  useAppStore.getState().setCurrentUser({ ...current, targetLevel: level })
}

export const completeMockGoogleCallback = async (): Promise<void> => {
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

const mockGoogleActorIds = {
  author: DEMO_ADMIN_ID,
  reviewer: DEMO_REVIEWER_ADMIN_ID,
  learner: DEMO_USER_ID,
  insightsLearner: DEMO_USER_ID
} as const
export type MockGoogleActor = keyof typeof mockGoogleActorIds

export const selectMockGoogleActor = (actor: MockGoogleActor): void => {
  assertMockTestMode()
  setMockSsoAccountForTesting('google', mockGoogleActorIds[actor])
}

export const completeMockGoogleActorCallback = async (
  actor: MockGoogleActor
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
    principal.user.id !== mockGoogleActorIds[actor]
  ) {
    throw new Error('Mock callback did not confirm the selected actor.')
  }
}

export type DashboardStatsFault = 'malformed' | 'network' | 'rate-limit'

const dashboardStatsPath = '*/api/v1/dashboard'

const createRateLimitFailure = () =>
  http.get(
    dashboardStatsPath,
    () => {
      const requestId = crypto.randomUUID()
      return HttpResponse.json(
        {
          code: 'RATE_LIMITED',
          message: 'Browser rate-limit fault injection',
          requestId,
          retryable: true
        },
        {
          status: 429,
          headers: {
            'Cache-Control': 'private, no-store',
            'Retry-After': '0',
            'X-Nihongo-Test-Fault': 'dashboard-stats-429',
            'X-Request-Id': requestId
          }
        }
      )
    },
    { once: true }
  )

export const armDashboardStatsFault = (fault: DashboardStatsFault): void => {
  assertMockTestMode()
  if (fault === 'network') {
    worker.use(
      http.get(dashboardStatsPath, () => HttpResponse.error(), {
        once: true
      }),
      http.get(dashboardStatsPath, () => HttpResponse.error(), {
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
      dashboardStatsPath,
      () =>
        HttpResponse.json(
          { malformed: true },
          {
            headers: {
              'Cache-Control': 'private, no-store',
              'X-Nihongo-Test-Fault': 'dashboard-stats-malformed'
            }
          }
        ),
      { once: true }
    )
  )
}

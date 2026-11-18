import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAppNavigate } from '@nihongo/browser/libs/appNavigation'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { takeOnboardingCheck } from '@app/login/onboardingMarker'
import {
  ONBOARDING_PATH,
  onboardingPath,
  studyGoalQueries
} from '@app/login/queries/studyGoalQueries'

// A goal written in the last minute (the page itself) needs no second read.
const CHECK_STALE_MS = 60_000

/**
 * #1090 O-1: right after sign-in, a member who neither started nor skipped
 * the study goal page is sent there once, then back to where they were. The
 * sign-up check sends new members there itself, so it waits off /login.
 */
export const useOnboardingCheck = (): void => {
  const { user, isReady } = useAuth()
  const { pathname, search } = useLocation()
  const navigate = useAppNavigate()
  const queryClient = useQueryClient()
  const userId = isReady ? user?.id : undefined
  const waiting = pathname === '/login' || pathname === ONBOARDING_PATH

  useEffect(() => {
    if (!userId || waiting || !takeOnboardingCheck()) return
    const back = `${pathname}${search}`
    queryClient
      .fetchQuery({
        ...studyGoalQueries.goal(userId),
        staleTime: CHECK_STALE_MS
      })
      .then((goal) => {
        if (goal.onboardingRequired)
          void navigate(onboardingPath(back), { replace: true })
      })
      // A failed read asks again at the next sign-in.
      .catch(() => undefined)
    // Once per sign-in; the marker keeps it to one read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, waiting])
}

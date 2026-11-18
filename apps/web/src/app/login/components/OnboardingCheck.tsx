import { lazy, Suspense, useMemo } from 'react'
import type { ReactElement } from 'react'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { hasOnboardingCheck } from '@app/login/onboardingMarker'

// The check lives in the login chunk (with the page it opens), so ordinary
// visits never load it; only a sign-in in this tab does.
const OnboardingCheckRunner = lazy(() =>
  import('@app/login/page').then((module) => ({
    default: module.OnboardingCheckRunner
  }))
)

/** Opens the study goal page once after sign-in while it is due (#1090). */
export const OnboardingCheck = (): ReactElement | null => {
  const { user } = useAuth()
  const userId = user?.id
  // Looked at again when the member changes (an in-app mock sign-in).
  const armed = useMemo(
    () => userId !== undefined && hasOnboardingCheck(),
    [userId]
  )
  return armed ? (
    <Suspense fallback={null}>
      <OnboardingCheckRunner />
    </Suspense>
  ) : null
}

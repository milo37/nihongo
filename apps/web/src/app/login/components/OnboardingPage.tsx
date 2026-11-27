import { useTranslation } from 'react-i18next'
import { Navigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { EDIT_RETURN_PATH } from '@app/login/hooks/useStudyGoalPage'
import { StudyGoalForm } from '@app/login/components/StudyGoalForm'

// My page opens the page to come back to itself; anything else is a sign-in
// return and follows the same rule.
const readRedirect = (value: string | null): string =>
  value === EDIT_RETURN_PATH ? value : safeSsoReturnPath(value)

/**
 * #1090 '학습 목표': one page after the sign-up check (and once after a
 * sign-in while it is due), and the same page from My page. Guests have no
 * study goal; the layout shows only the logo here.
 */
export const OnboardingPage = (): ReactElement => {
  const { t } = useTranslation('auth')
  const [search] = useSearchParams()
  const { isReady, user } = useAuth()
  const redirect = readRedirect(search.get('redirect'))
  if (!isReady) {
    return (
      <section className="auth-page">
        <p role="status">{t('sso.checkingSession')}</p>
      </section>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return (
    <section className="auth-page study-goal-page">
      <StudyGoalForm key={user.id} userId={user.id} redirect={redirect} />
    </section>
  )
}

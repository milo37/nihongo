import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
import {
  ACCOUNT_FRESH_PARAM,
  ACCOUNT_REAUTH_PARAM
} from '@app/account/hooks/useSsoAccountManagement'
import { RestoreCard } from '@app/login/components/RestoreCard'
import { SignupConsentPage } from '@app/login/components/SignupConsentPage'
// #1090: the study goal page follows the sign-up check, so it shares this
// chunk instead of adding a file of its own.
export { OnboardingPage } from '@app/login/components/OnboardingPage'
export { OnboardingCheckRunner } from '@app/login/components/OnboardingCheckRunner'
import type { SignupConsentExit } from '@app/login/hooks/useSignupConsent'
import type { RestoreFailure } from '@app/login/hooks/useAccountRestore'
import { SignInCard } from '@app/login/components/SignInCard'
import { SignedInRedirect } from '@app/login/components/SignedInRedirect'
import { LoginGuestHint } from '@app/login/components/LoginGuestHint'
import { useDeletionNotice } from '@app/login/hooks/useDeletionNotice'
import {
  SIGNUP_CONSENT_OUTCOME,
  errorNotices,
  readNotice,
  toSignInNotice
} from '@app/login/loginNotice'
import type { Notice } from '@app/login/loginNotice'
import { useAppNavigate } from '@nihongo/browser/libs/appNavigation'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

export const LoginPage = (): ReactElement => {
  const { t } = useTranslation('auth')
  const navigate = useAppNavigate()
  const location = useLocation()
  const [search] = useSearchParams()
  const { isReady, user } = useAuth()
  const heading = useRef<HTMLHeadingElement>(null)
  const redirect = safeSsoReturnPath(search.get('redirect'))
  const accountReturn = search.get(ACCOUNT_FRESH_PARAM)
  const [notice, setNotice] = useState<Notice | null>(() =>
    readNotice(search, location.state)
  )
  const deletionNotice = useDeletionNotice(notice === 'DELETION')
  const restoring = notice === 'RESTORE_AVAILABLE'
  const consenting = notice === SIGNUP_CONSENT_OUTCOME
  const onRestoreFailed = useCallback(
    (failure: RestoreFailure) => setNotice(failure),
    []
  )
  const onConsentExit = useCallback(
    (exit: SignupConsentExit) => setNotice(exit),
    []
  )

  useEffect(() => {
    // The restore card keeps ?sso=RESTORE_AVAILABLE so the layout hides the
    // ways out until the visitor chooses (design state ①·②).
    if (accountReturn !== null || restoring || consenting) return
    const canonical = new URLSearchParams()
    if (redirect !== '/') canonical.set('redirect', redirect)
    const desired = canonical.toString()
    if (
      location.search !== (desired ? '?' + desired : '') ||
      location.hash ||
      location.state
    ) {
      void navigate(
        { pathname: '/login', search: desired, hash: '' },
        { replace: true, state: null }
      )
    }
  }, [
    accountReturn,
    restoring,
    consenting,
    location.hash,
    location.search,
    location.state,
    navigate,
    redirect
  ])

  useEffect(() => {
    // Error notices focus the Google button inside the card instead.
    if (
      notice &&
      isReady &&
      !errorNotices.has(notice) &&
      !restoring &&
      !consenting
    )
      heading.current?.focus()
  }, [consenting, isReady, notice, restoring])

  if (!isReady) {
    return (
      <section className="auth-page">
        <p role="status">{t('sso.checkingSession')}</p>
      </section>
    )
  }
  if (user) {
    return (
      <SignedInRedirect
        isAdmin={user.role === 'ADMIN'}
        redirect={redirect}
        accountReturn={accountReturn}
        reauth={search.get(ACCOUNT_REAUTH_PARAM)}
      />
    )
  }

  if (consenting) {
    return (
      <section className="auth-page signup-consent-page">
        <SignupConsentPage redirect={redirect} onExit={onConsentExit} />
      </section>
    )
  }

  if (restoring) {
    return (
      <section className="auth-page">
        <RestoreCard redirect={redirect} onFailed={onRestoreFailed} />
      </section>
    )
  }

  const shown = toSignInNotice(notice, deletionNotice, (key) =>
    t(key, { provider: 'Google' })
  )
  return (
    <section className="auth-page">
      <SignInCard
        title={t('sso.title')}
        description={t('sso.description')}
        redirect={redirect}
        notice={shown}
        headingRef={heading}
        onStart={() => setNotice(null)}
      />
      <LoginGuestHint redirect={redirect} />
    </section>
  )
}

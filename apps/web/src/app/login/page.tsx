import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import {
  safeSsoReturnPath,
  ssoCallbackOutcomeSchema
} from '@nihongo/contracts/auth/sign-in-social'
import type {
  SsoCallbackOutcome,
  SsoProviderId
} from '@nihongo/contracts/auth/sign-in-social'
import { SsoAccountManagement } from '@app/login/components/SsoAccountManagement'
import {
  accountFreshOutcomeSchema,
  accountLinkOutcomeSchema
} from '@nihongo/contracts/auth/sso-account-management'
import { AdminFreshEntry } from '@app/login/components/AdminFreshEntry'
import { AuthFlowError } from '@app/login/authFlowErrors'
import { SsoProviderButton } from '@app/login/components/SsoProviderButton'
import { useLogoutUser } from '@app/login/hooks/useLogoutUser'
import { useStartSocialSignIn } from '@app/login/hooks/useStartSocialSignIn'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { useAuth } from '@provider/ProtectedRouteProvider'

type Notice = SsoCallbackOutcome | 'LEGACY' | 'EXPIRED'

const hasStateFlag = (state: unknown, flag: string): boolean =>
  state !== null &&
  typeof state === 'object' &&
  flag in state &&
  Reflect.get(state, flag) === true

export const LoginPage = (): ReactElement => {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const location = useLocation()
  const [search] = useSearchParams()
  const { isReady, user } = useAuth()
  const start = useStartSocialSignIn()
  const logout = useLogoutUser()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const logoutButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const appleButton = useRef<HTMLButtonElement>(null)
  const googleButton = useRef<HTMLButtonElement>(null)
  const redirect = safeSsoReturnPath(search.get('redirect'))
  const [notice, setNotice] = useState<Notice | null>(() => {
    if (search.has('sso')) {
      const outcome = ssoCallbackOutcomeSchema.safeParse(search.get('sso'))
      return outcome.success ? outcome.data : 'INVALID_CALLBACK'
    }
    if (search.has('mode') || hasStateFlag(location.state, 'legacyAuthMethod'))
      return 'LEGACY'
    if (hasStateFlag(location.state, 'sessionExpired')) return 'EXPIRED'
    return null
  })
  const busy = start.isPending || start.isRedirecting
  const provider = start.variables?.provider
  const providerName = provider === 'apple' ? 'Apple' : 'Google'

  useEffect(() => {
    const canonical = new URLSearchParams()
    if (redirect !== '/') canonical.set('redirect', redirect)
    for (const [key, schema] of [
      ['ssoAccountFresh', accountFreshOutcomeSchema],
      ['ssoAccountLink', accountLinkOutcomeSchema]
    ] as const) {
      const values = search.getAll(key)
      const parsed = schema.safeParse(values[0])
      if (values.length === 1 && parsed.success) canonical.set(key, parsed.data)
    }
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
    location.hash,
    location.search,
    location.state,
    navigate,
    redirect,
    search
  ])

  useEffect(() => {
    if (notice) heading.current?.focus()
  }, [notice])

  useEffect(() => {
    if (start.isError) {
      ;(provider === 'apple' ? appleButton : googleButton).current?.focus()
    }
  }, [provider, start.isError])

  const begin = (selected: SsoProviderId): void => {
    if (busy) return
    setNotice(null)
    start.mutate({ provider: selected, callbackURL: redirect })
  }
  const noticeKey =
    notice === 'CANCELLED'
      ? 'cancelled'
      : notice === 'FAILED'
        ? 'failed'
        : notice === 'INVALID_CALLBACK'
          ? 'expired'
          : notice === 'EXPIRED'
            ? 'sessionExpired'
            : 'legacyMethod'
  const failed = notice === 'FAILED' || notice === 'INVALID_CALLBACK'
  const errorKey =
    start.error instanceof AuthFlowError && start.error.unavailable
      ? 'unavailableProvider'
      : 'failedProvider'

  return (
    <section className="auth-page">
      <div className="auth-panel">
        <header className="auth-heading">
          <h1 ref={heading} tabIndex={notice ? -1 : undefined}>
            {!isReady
              ? t('sso.checkingSession')
              : user
                ? t('sso.alreadySignedIn')
                : t('sso.title')}
          </h1>
          {isReady ? (
            <p>{user ? t('currentDescription') : t('sso.description')}</p>
          ) : null}
        </header>
        {!isReady ? (
          <p className="auth-notice" role="status">
            {t('sso.checkingSession')}
          </p>
        ) : user ? (
          <>
            <div className="auth-account">
              <span>{t('currentAccount')}</span>
              <strong>{user.name}</strong>
            </div>
            {user.role === 'ADMIN' ? (
              <AdminFreshEntry
                returnPath={redirect === '/' ? '/login' : redirect}
                disabled={logoutOpen || logout.isPending}
              />
            ) : null}
            <div className="auth-actions">
              <Button
                fullWidth
                onClick={() => void navigate(redirect, { replace: true })}
              >
                {t('sso.backToLearning')}
              </Button>
              <Button
                ref={logoutButton}
                fullWidth
                variant="outline"
                onClick={() => setLogoutOpen(true)}
              >
                {t('sso.logoutAction')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="auth-actions" aria-busy={busy || undefined}>
              <SsoProviderButton
                provider="google"
                label={t('sso.continueGoogle')}
                disabled={busy}
                buttonRef={googleButton}
                onClick={() => begin('google')}
              />
            </div>
            {busy ? (
              <p className="auth-notice" role="status">
                {t('sso.redirecting', { provider: providerName })}
              </p>
            ) : null}
            {start.isError ? (
              <p className="auth-notice auth-error" role="alert">
                {t('sso.' + errorKey, { provider: providerName })}
              </p>
            ) : notice ? (
              <p
                className={'auth-notice' + (failed ? ' auth-error' : '')}
                role={failed ? 'alert' : 'status'}
              >
                {t('sso.' + noticeKey)}
              </p>
            ) : null}
            <div className="auth-guest">
              <Link
                to={
                  redirect === '/' || redirect.startsWith('/practice')
                    ? redirect
                    : '/practice'
                }
              >
                {t('sso.guest')}
              </Link>
            </div>
          </>
        )}
        <SsoAccountManagement />
      </div>
      <Dialog
        open={logoutOpen && user !== null}
        onOpenChange={setLogoutOpen}
        title={t('sso.logoutTitle')}
        description={t('sso.logoutDescription')}
        preventClose={logout.isPending}
        initialFocusRef={cancelButton}
        returnFocusRef={logoutButton}
        fallbackFocusRef={heading}
        footer={
          <>
            <Button
              ref={cancelButton}
              variant="outline"
              disabled={logout.isPending}
              onClick={() => setLogoutOpen(false)}
            >
              {t('sso.cancel')}
            </Button>
            <Button
              disabled={logout.isPending}
              onClick={() =>
                logout.isError ? logout.recheck() : logout.mutate()
              }
            >
              {t(logout.isError ? 'sso.recheck' : 'sso.logoutAction')}
            </Button>
          </>
        }
      >
        {logout.isPending ? <p role="status">{t('sso.loggingOut')}</p> : null}
        {logout.isError ? <p role="alert">{t('sso.logoutUnknown')}</p> : null}
      </Dialog>
    </section>
  )
}

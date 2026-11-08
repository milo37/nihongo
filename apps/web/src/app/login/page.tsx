import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import {
  safeSsoReturnPath,
  ssoCallbackOutcomeSchema
} from '@nihongo/contracts/auth/sign-in-social'
import type { SsoCallbackOutcome } from '@nihongo/contracts/auth/sign-in-social'
import { ACCOUNT_FRESH_PARAM } from '@app/account/hooks/useSsoAccountManagement'
import { AdminFreshEntry } from '@app/login/components/AdminFreshEntry'
import { SignInCard } from '@app/login/components/SignInCard'
import type { SignInNotice } from '@app/login/components/SignInCard'
import { useSsoAccountDeletion } from '@app/login/hooks/useSsoAccountDeletion'
import { useAppNavigate } from '@nihongo/browser/libs/appNavigation'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

type Notice =
  | SsoCallbackOutcome
  | 'LEGACY'
  | 'EXPIRED'
  | 'DELETION'
  | 'UNLINKED'

const hasStateFlag = (state: unknown, flag: string): boolean =>
  state !== null &&
  typeof state === 'object' &&
  flag in state &&
  Reflect.get(state, flag) === true

const readNotice = (search: URLSearchParams, state: unknown): Notice | null => {
  if (search.has('sso')) {
    const outcome = ssoCallbackOutcomeSchema.safeParse(search.get('sso'))
    return outcome.success ? outcome.data : 'INVALID_CALLBACK'
  }
  if (search.has('mode') || hasStateFlag(state, 'legacyAuthMethod'))
    return 'LEGACY'
  if (hasStateFlag(state, 'sessionExpired')) return 'EXPIRED'
  if (hasStateFlag(state, 'deletionRequested')) return 'DELETION'
  if (hasStateFlag(state, 'accountUnlinked')) return 'UNLINKED'
  return null
}

const noticeKeys: Record<Exclude<Notice, 'DELETION'>, string> = {
  CANCELLED: 'sso.cancelledProvider',
  FAILED: 'sso.failedProvider',
  INVALID_CALLBACK: 'sso.expired',
  EXPIRED: 'sso.sessionExpired',
  LEGACY: 'sso.legacyMethod',
  UNLINKED: 'sso.unlinked'
}

// Shows the account deletion result once, only right after this browser
// requested it; ordinary visitors never query the deletion receipt.
const useDeletionNotice = (active: boolean): string | null => {
  const { t } = useTranslation('auth')
  const { receipt } = useSsoAccountDeletion(active)
  if (!active) return null
  if (receipt.isPending) return t('sso.checkingAccount')
  return t(
    receipt.data?.appStatus === 'DELETED'
      ? 'sso.deletionComplete'
      : 'sso.deletionAccepted'
  )
}

// /login is for signed-out visitors. Signed-in visitors go to learning home,
// except two hand-offs that still arrive here: account verification returns
// (forwarded to /account) and admin verification opened from the admin app.
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

  useEffect(() => {
    if (accountReturn !== null) return
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
    location.hash,
    location.search,
    location.state,
    navigate,
    redirect
  ])

  useEffect(() => {
    if (notice && isReady) heading.current?.focus()
  }, [isReady, notice])

  if (!isReady) {
    return (
      <section className="auth-page">
        <p role="status">{t('sso.checkingSession')}</p>
      </section>
    )
  }
  if (user) {
    if (accountReturn !== null) {
      const forward = new URLSearchParams()
      forward.set(ACCOUNT_FRESH_PARAM, accountReturn)
      return (
        <Navigate
          replace
          to={{ pathname: '/account', search: forward.toString() }}
        />
      )
    }
    if (user.role === 'ADMIN' && redirect.startsWith('/admin')) {
      return (
        <section className="auth-page">
          <div className="auth-panel">
            <AdminFreshEntry returnPath={redirect} />
          </div>
        </section>
      )
    }
    return <Navigate replace to="/" />
  }

  const shown: SignInNotice | null =
    notice === null
      ? null
      : notice === 'DELETION'
        ? deletionNotice
          ? { message: deletionNotice, tone: 'info' }
          : null
        : {
            message: t(noticeKeys[notice], { provider: 'Google' }),
            tone:
              notice === 'FAILED' || notice === 'INVALID_CALLBACK'
                ? 'error'
                : 'info'
          }
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
      <p className="auth-guest-hint">
        {t('sso.guestHint')}{' '}
        <Link to={redirect.startsWith('/practice') ? redirect : '/practice'}>
          {t('sso.guestLink')}
        </Link>
      </p>
    </section>
  )
}

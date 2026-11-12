import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import {
  safeSsoReturnPath,
  ssoCallbackOutcomeSchema
} from '@nihongo/contracts/auth/sign-in-social'
import type { SsoCallbackOutcome } from '@nihongo/contracts/auth/sign-in-social'
import {
  ACCOUNT_FRESH_PARAM,
  ACCOUNT_REAUTH_PARAM
} from '@app/account/hooks/useSsoAccountManagement'
import { RestoreCard } from '@app/login/components/RestoreCard'
import type { RestoreFailure } from '@app/login/hooks/useAccountRestore'
import { SignInCard } from '@app/login/components/SignInCard'
import { formatErasureDate } from '@app/login/erasureDate'
import type { SignInNotice } from '@app/login/components/SignInCard'
import { useSsoAccountDeletion } from '@app/login/hooks/useSsoAccountDeletion'
import {
  GUEST_DAILY_SESSION_LIMIT,
  GUEST_SESSION_QUESTION_LIMIT
} from '@nihongo/contracts/study/guest-limits'
import {
  appDocumentNavigation,
  useAppNavigate
} from '@nihongo/browser/libs/appNavigation'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

type Notice =
  | SsoCallbackOutcome
  | RestoreFailure
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

const errorNotices: ReadonlySet<Notice> = new Set([
  'FAILED',
  'INVALID_CALLBACK',
  'RESTORE_FAILED',
  'RESTORE_TOO_LATE'
])

// RESTORE_AVAILABLE is not a notice: it shows the restore card (JLP-845).
const noticeKeys: Record<
  Exclude<Notice, 'DELETION' | 'RESTORE_AVAILABLE'>,
  string
> = {
  CANCELLED: 'sso.cancelledProvider',
  FAILED: 'sso.failedProvider',
  INVALID_CALLBACK: 'sso.expired',
  RESTORE_FAILED: 'recover.failed',
  RESTORE_TOO_LATE: 'recover.tooLate',
  EXPIRED: 'sso.sessionExpired',
  LEGACY: 'sso.legacyMethod',
  UNLINKED: 'sso.unlinked'
}

// Shows the account deletion result once, only right after this browser
// requested it; ordinary visitors never query the deletion receipt.
const useDeletionNotice = (active: boolean): string | null => {
  const { t, i18n } = useTranslation('auth')
  // Lazy routes read the locale here, not from I18nProvider (one chunk).
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const { receipt } = useSsoAccountDeletion(active)
  if (!active) return null
  if (receipt.isPending) return t('sso.checkingAccount')
  // JLP-847: the request was already accepted; a failed receipt read only
  // loses the date, so still confirm it without one.
  if (receipt.isError) return t('sso.deletionAcceptedNoDate')
  // JLP-845: erasure waits 7 days, so the notice carries its date.
  const scheduledAt = receipt.data?.deletionScheduledAt
  return scheduledAt
    ? t('sso.deletionAccepted', {
        date: formatErasureDate(scheduledAt, locale)
      })
    : null
}

// /login is for signed-out visitors. Signed-in visitors go to learning home,
// except two hand-offs that still arrive here: account verification returns
// (forwarded to /account) and admin verification opened from the admin app.
/** The admin app is another document, so leave the learner router. */
const AdminDocumentReturn = ({ to }: { readonly to: string }): null => {
  useEffect(() => appDocumentNavigation.replace(to), [to])
  return null
}

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
  const onRestoreFailed = useCallback(
    (failure: RestoreFailure) => setNotice(failure),
    []
  )

  useEffect(() => {
    // The restore card keeps ?sso=RESTORE_AVAILABLE so the layout hides the
    // ways out until the visitor chooses (design state ①·②).
    if (accountReturn !== null || restoring) return
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
    location.hash,
    location.search,
    location.state,
    navigate,
    redirect
  ])

  useEffect(() => {
    // Error notices focus the Google button inside the card instead.
    if (notice && isReady && !errorNotices.has(notice) && !restoring)
      heading.current?.focus()
  }, [isReady, notice, restoring])

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
      const reauth = search.get(ACCOUNT_REAUTH_PARAM)
      if (reauth !== null) forward.set(ACCOUNT_REAUTH_PARAM, reauth)
      return (
        <Navigate
          replace
          to={{ pathname: '/account', search: forward.toString() }}
        />
      )
    }
    // Admin pages start re-verification themselves; an old
    // /login?redirect=/admin/... link just goes back to the admin page.
    if (user.role === 'ADMIN' && redirect.startsWith('/admin'))
      return <AdminDocumentReturn to={redirect} />
    return <Navigate replace to="/" />
  }

  if (restoring) {
    return (
      <section className="auth-page">
        <RestoreCard redirect={redirect} onFailed={onRestoreFailed} />
      </section>
    )
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
            tone: errorNotices.has(notice) ? 'error' : 'info'
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
        {t('sso.guestHint', {
          total: GUEST_DAILY_SESSION_LIMIT,
          count: GUEST_SESSION_QUESTION_LIMIT
        })}{' '}
        <Link to={redirect.startsWith('/practice') ? redirect : '/practice'}>
          {t('sso.guestLink')}
        </Link>
      </p>
    </section>
  )
}

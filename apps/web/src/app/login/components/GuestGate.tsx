import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import { SignInCard } from '@app/login/components/SignInCard'
import { getRouteLabelKey } from '@nihongo/browser/i18n/routePresentation'

export type GuestGateScreen =
  | 'account'
  | 'bookmarks'
  | 'dashboard'
  | 'review'
  | 'wrongNote'

const icons: Record<GuestGateScreen, string> = {
  account: '👤',
  bookmarks: '★',
  dashboard: '▦',
  review: '↻',
  wrongNote: '↻'
}

const screenFor = (pathname: string): GuestGateScreen =>
  pathname === '/bookmarks'
    ? 'bookmarks'
    : pathname === '/dashboard'
      ? 'dashboard'
      : pathname === '/account'
        ? 'account'
        : pathname === '/wrong-notes'
          ? 'review'
          : 'wrongNote'

type GuestGateProps = {
  /** Defaults to the screen of the current path. */
  screen?: GuestGateScreen
  children?: ReactNode
}

/**
 * A member-only screen opened by a guest (U4 R4): explains the screen and
 * offers Google sign-in back to this path, instead of a silent redirect.
 * Not an error, so no red and no alert role.
 */
export const GuestGate = ({
  screen,
  children
}: GuestGateProps): ReactElement => {
  const { t } = useTranslation('auth')
  const { t: navigationT } = useTranslation('navigation')
  const { t: accountT } = useTranslation('account')
  const location = useLocation()
  const shown = screen ?? screenFor(location.pathname)
  return (
    <section className="auth-page guest-gate-page">
      <h1 className="sr-only">
        {navigationT(getRouteLabelKey(location.pathname))}
      </h1>
      <SignInCard
        headingLevel="h2"
        icon={icons[shown]}
        title={t('guestGate.title')}
        description={
          shown === 'account'
            ? accountT('guestDescription')
            : t(`guestGate.${shown}`)
        }
        redirect={`${location.pathname}${location.search}`}
        footer={
          <p className="guest-gate-links">
            <Link to="/practice">{t('guestGate.toStudy')}</Link>
            {children}
          </p>
        }
      />
    </section>
  )
}

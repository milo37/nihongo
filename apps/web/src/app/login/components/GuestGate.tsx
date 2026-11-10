import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import { SignInCard } from '@app/login/components/SignInCard'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { IconName } from '@nihongo/browser/common/components/Icon'
import { getRouteLabelKey } from '@nihongo/browser/i18n/routePresentation'

export type GuestGateScreen =
  | 'account'
  | 'bookmarks'
  | 'dashboard'
  | 'review'
  | 'wrongNote'

// Lucide icons, matching the navigation tabs (G).
const icons: Record<GuestGateScreen, IconName> = {
  account: 'user-round',
  bookmarks: 'bookmark',
  dashboard: 'house',
  review: 'rotate-ccw',
  wrongNote: 'rotate-ccw'
}

// What gathers on each tab (copy v2.1 §5): My page shows the dashboard's.
const copyKeys = {
  account: 'dashboard',
  bookmarks: 'bookmarks',
  dashboard: 'dashboard',
  review: 'wrongNote',
  wrongNote: 'wrongNote'
} as const satisfies Record<GuestGateScreen, string>

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
 * A member-only screen opened by a guest (U4 R4, card C): says what gathers
 * here, then [로그인] back to this path and [그냥 풀러 가기] to the first
 * screen. No lock: not an error, so no red and no alert role.
 */
export const GuestGate = ({
  screen,
  children
}: GuestGateProps): ReactElement => {
  const { t } = useTranslation('auth')
  const { t: navigationT } = useTranslation('navigation')
  const location = useLocation()
  const shown = screen ?? screenFor(location.pathname)
  const key = copyKeys[shown]
  return (
    <section className="auth-page guest-gate-page">
      <h1 className="sr-only">
        {navigationT(getRouteLabelKey(location.pathname))}
      </h1>
      <SignInCard
        headingLevel="h2"
        icon={<Icon name={icons[shown]} className="size-7" />}
        title={t(`guestGate.${key}`)}
        description={t(`guestGate.${key}Body`)}
        buttonLabel={t('guestGate.login')}
        redirect={`${location.pathname}${location.search}`}
        footer={
          <p className="guest-gate-links">
            <Link to="/">{t('guestGate.toStudy')}</Link>
            {children}
          </p>
        }
      />
    </section>
  )
}

import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { KeyboardEvent, ReactElement, RefObject } from 'react'
import { Avatar } from '@app/account/components/Avatar'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { IconName } from '@nihongo/browser/common/components/Icon'

const ItemIcon = ({ name }: { name: IconName }): ReactElement => (
  <Icon name={name} className="size-5 shrink-0 text-muted" />
)

const itemClassName =
  'account-menu-item flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sm'

// #994: a guest gets a plain [로그인] link instead of a menu; it carries the
// current screen as ?redirect= so sign-in returns there.
export const GuestLoginLink = ({
  pathname,
  search
}: {
  pathname: string
  search: string
}): ReactElement => {
  'use no memo'
  const { t } = useTranslation('navigation')
  // A guest's set and result are not kept after sign-in, so from those
  // screens the way back is the practice page (as useGuestAction does).
  const isGuestStudy = /^\/practice\/(?:session|result)\//u.test(pathname)
  const loginHref =
    pathname === '/' || pathname === '/login'
      ? '/login'
      : `/login?redirect=${encodeURIComponent(
          isGuestStudy ? '/practice' : `${pathname}${search}`
        )}`
  return (
    <div className="account-menu">
      <Link to={loginHref} className="account-menu-login">
        {t('login')}
      </Link>
    </div>
  )
}

/** The open menu: who is signed in, then My page, error report, logout. */
export const AccountMenuPanel = ({
  name,
  panelRef,
  menuRef,
  menuId,
  onKeyDown,
  onClose,
  onReportError,
  reportErrorLabel,
  onLogout
}: {
  name: string
  panelRef: RefObject<HTMLDivElement | null>
  menuRef: RefObject<HTMLDivElement | null>
  menuId: string
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onClose: () => void
  onReportError: () => void
  reportErrorLabel: string
  onLogout: () => void
}): ReactElement => {
  'use no memo'
  const { t } = useTranslation('navigation')
  const { t: authT } = useTranslation('auth')
  return (
    <div ref={panelRef} className="account-menu-panel" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-3 px-3 py-3">
        <Avatar name={name} size="sm" />
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold">{name}</p>
          <p className="text-caption text-muted">
            {t('accountMenu.signedInWith')}
          </p>
        </div>
      </div>
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        tabIndex={-1}
        aria-labelledby="account-menu-button"
        className="grid gap-1"
      >
        <div role="separator" className="account-menu-separator" />
        <Link
          role="menuitem"
          to="/account"
          className={itemClassName}
          onClick={onClose}
        >
          <ItemIcon name="user-round" />
          {t('accountMenu.myPage')}
        </Link>
        <button
          role="menuitem"
          type="button"
          className={itemClassName}
          onClick={() => {
            onClose()
            onReportError()
          }}
        >
          <ItemIcon name="circle-alert" />
          {reportErrorLabel}
        </button>
        <div role="separator" className="account-menu-separator" />
        <button
          role="menuitem"
          type="button"
          className={itemClassName}
          onClick={() => {
            onClose()
            onLogout()
          }}
        >
          <ItemIcon name="arrow-right" />
          {authT('sso.logoutAction')}
        </button>
      </div>
    </div>
  )
}

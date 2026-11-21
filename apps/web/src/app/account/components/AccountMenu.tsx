import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import type { ReactElement } from 'react'
import { Avatar } from '@app/account/components/Avatar'
import { AccountMenuPanel } from '@app/account/components/AccountMenuPanel'
import { LogoutDialog } from '@app/account/components/LogoutDialog'
import { useAccountMenu } from '@app/account/hooks/useAccountMenu'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

type AccountMenuProps = {
  /** Opens the app error report dialog owned by the layout. */
  onReportError: () => void
  reportErrorLabel: string
}

// Header account menu (keys and focus: useAccountMenu); a guest gets a
// [로그인] link instead.
export const AccountMenu = ({
  onReportError,
  reportErrorLabel
}: AccountMenuProps): ReactElement => {
  const { t } = useTranslation('navigation')
  const { user } = useAuth()
  const { pathname, search } = useLocation()
  const menu = useAccountMenu(pathname)
  const { open, trigger } = menu
  const [logoutOpen, setLogoutOpen] = useState(false)
  // Mounted after first use so the closing dialog can still restore focus.
  const [hasLogout, setHasLogout] = useState(false)
  if (!user) {
    // #994: a guest gets a plain [로그인] link that carries the current
    // screen as ?redirect=. A guest's set and result are not kept after
    // sign-in, so from those screens the way back is the practice page (as
    // useGuestAction does).
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
  return (
    <div className="account-menu">
      <button
        ref={trigger}
        id="account-menu-button"
        type="button"
        className="account-menu-trigger"
        aria-label={t('accountMenu.label')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menu.menuId : undefined}
        onClick={(event) =>
          // Enter and Space fire a click with detail 0.
          menu.setOpenAt(open ? null : event.detail === 0 ? 'first' : 'menu')
        }
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            menu.setOpenAt('first')
          }
        }}
      >
        <Avatar name={user.name} size="sm" />
        <span className="account-menu-name">{user.name}</span>
        <Icon
          name="chevron-right"
          className="account-menu-caret size-4 rotate-90"
        />
      </button>
      {open ? (
        <AccountMenuPanel
          name={user.name}
          panelRef={menu.panel}
          menuRef={menu.menu}
          menuId={menu.menuId}
          onKeyDown={menu.onMenuKeyDown}
          onClose={() => menu.close(false)}
          onReportError={onReportError}
          reportErrorLabel={reportErrorLabel}
          onLogout={() => {
            setHasLogout(true)
            setLogoutOpen(true)
          }}
        />
      ) : null}
      {hasLogout ? (
        <LogoutDialog
          open={logoutOpen}
          onOpenChange={setLogoutOpen}
          returnFocusRef={trigger}
        />
      ) : null}
    </div>
  )
}

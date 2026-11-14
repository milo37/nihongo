import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import type { KeyboardEvent, ReactElement } from 'react'
import { Avatar } from '@app/account/components/Avatar'
import { LogoutDialog } from '@app/account/components/LogoutDialog'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { IconName } from '@nihongo/browser/common/components/Icon'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

type AccountMenuProps = {
  /** Opens the app error report dialog owned by the layout. */
  onReportError: () => void
  reportErrorLabel: string
}

const ITEM_SELECTOR = '[role="menuitem"]'

const ItemIcon = ({ name }: { name: IconName }): ReactElement => (
  <Icon name={name} className="size-5 shrink-0 text-muted" />
)

// Header account menu (WAI-ARIA menu button). Arrow keys move between items,
// Escape closes and returns focus to the trigger, and an outside click closes.
// JLP-849: only a keyboard open focuses the first item. A tap or click
// focuses the menu box instead, because iOS Safari draws the keyboard ring
// on any item focused by script.
// #994: a guest gets a plain [로그인] link instead of a menu; it carries the
// current screen as ?redirect= so sign-in returns there.
export const AccountMenu = ({
  onReportError,
  reportErrorLabel
}: AccountMenuProps): ReactElement => {
  const { t } = useTranslation('navigation')
  const { t: authT } = useTranslation('auth')
  const { user } = useAuth()
  const { pathname, search } = useLocation()
  // Where focus goes when the menu opens; null means closed.
  const [openAt, setOpenAt] = useState<'first' | 'menu' | null>(null)
  const open = openAt !== null
  const [logoutOpen, setLogoutOpen] = useState(false)
  // Mounted after first use so the closing dialog can still restore focus.
  const [hasLogout, setHasLogout] = useState(false)
  const [closedPath, setClosedPath] = useState(pathname)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  if (closedPath !== pathname) {
    setClosedPath(pathname)
    setOpenAt(null)
  }
  const items = (): HTMLElement[] =>
    Array.from(
      panel.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []
    )
  useEffect(() => {
    if (!openAt) return
    if (openAt === 'first') items()[0]?.focus()
    else menu.current?.focus()
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target as Node
      if (
        !panel.current?.contains(target) &&
        !trigger.current?.contains(target)
      )
        setOpenAt(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [openAt])
  const close = (returnFocus: boolean): void => {
    setOpenAt(null)
    if (returnFocus) trigger.current?.focus()
  }
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const list = items()
    const index = list.indexOf(document.activeElement as HTMLElement)
    const move = (next: number): void => {
      event.preventDefault()
      list[(next + list.length) % list.length]?.focus()
    }
    if (event.key === 'ArrowDown') move(index + 1)
    else if (event.key === 'ArrowUp')
      move(index < 0 ? list.length - 1 : index - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(list.length - 1)
    else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') close(false)
  }
  if (!user) {
    const loginHref =
      pathname === '/' || pathname === '/login'
        ? '/login'
        : `/login?redirect=${encodeURIComponent(`${pathname}${search}`)}`
    return (
      <div className="account-menu">
        <Link to={loginHref} className="account-menu-login">
          {t('login')}
        </Link>
      </div>
    )
  }
  const itemClassName =
    'account-menu-item flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sm'
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
        aria-controls={open ? menuId : undefined}
        onClick={(event) =>
          // Enter and Space fire a click with detail 0.
          setOpenAt(open ? null : event.detail === 0 ? 'first' : 'menu')
        }
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpenAt('first')
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
        <div
          ref={panel}
          className="account-menu-panel"
          onKeyDown={onMenuKeyDown}
        >
          <div className="flex items-center gap-3 px-3 py-3">
            <Avatar name={user.name} size="sm" />
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold">{user.name}</p>
              <p className="text-caption text-muted">
                {t('accountMenu.signedInWith')}
              </p>
            </div>
          </div>
          <div
            ref={menu}
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
              onClick={() => close(false)}
            >
              <ItemIcon name="user-round" />
              {t('accountMenu.myPage')}
            </Link>
            <button
              role="menuitem"
              type="button"
              className={itemClassName}
              onClick={() => {
                close(false)
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
                close(false)
                setHasLogout(true)
                setLogoutOpen(true)
              }}
            >
              <ItemIcon name="arrow-right" />
              {authT('sso.logoutAction')}
            </button>
          </div>
        </div>
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

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import type { KeyboardEvent, ReactElement } from 'react'
import { Avatar } from '@app/account/components/Avatar'
import { LogoutDialog } from '@app/account/components/LogoutDialog'
import { getButtonClassName } from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { IconName } from '@nihongo/browser/common/components/Icon'
import { UI_LOCALES } from '@nihongo/browser/i18n/types'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

type AccountMenuProps = {
  /** Opens the app error report dialog owned by the layout. */
  onReportError: () => void
  reportErrorLabel: string
}

const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"]'

const ItemIcon = ({ name }: { name: IconName }): ReactElement => (
  <Icon name={name} className="size-5 shrink-0 text-muted" />
)

// Header account menu (WAI-ARIA menu button). Arrow keys move between items,
// Escape closes and returns focus to the trigger, and an outside click closes.
export const AccountMenu = ({
  onReportError,
  reportErrorLabel
}: AccountMenuProps): ReactElement => {
  const { t } = useTranslation('navigation')
  const { t: commonT } = useTranslation('common')
  const { t: authT } = useTranslation('auth')
  const { user } = useAuth()
  const { locale, setLocale } = useUiLocale()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  // Mounted after first use so the closing dialog can still restore focus.
  const [hasLogout, setHasLogout] = useState(false)
  const [closedPath, setClosedPath] = useState(pathname)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const languageId = useId()
  if (closedPath !== pathname) {
    setClosedPath(pathname)
    setOpen(false)
  }
  const items = (): HTMLElement[] =>
    Array.from(
      panel.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []
    )
  useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target as Node
      if (
        !panel.current?.contains(target) &&
        !trigger.current?.contains(target)
      )
        setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])
  const close = (returnFocus: boolean): void => {
    setOpen(false)
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
    else if (event.key === 'ArrowUp') move(index - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(list.length - 1)
    else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') close(false)
  }
  const itemClassName =
    'flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sm hover:bg-surface-muted focus-visible:bg-surface-muted'
  return (
    <div className="account-menu">
      <button
        ref={trigger}
        id="account-menu-button"
        type="button"
        className={user ? 'account-menu-trigger' : 'account-menu-login'}
        aria-label={user ? t('accountMenu.label') : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {user ? (
          <>
            <Avatar name={user.name} size="sm" />
            <span className="account-menu-name">{user.name}</span>
            <Icon
              name="chevron-right"
              className="account-menu-caret size-4 rotate-90"
            />
          </>
        ) : (
          t('login')
        )}
      </button>
      {open ? (
        <div
          ref={panel}
          className="account-menu-panel"
          onKeyDown={onMenuKeyDown}
        >
          <div className="flex items-center gap-3 px-3 py-3">
            {user ? <Avatar name={user.name} size="sm" /> : null}
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold">
                {user ? user.name : t('accountMenu.guestTitle')}
              </p>
              <p className="text-caption text-muted">
                {user
                  ? t('accountMenu.signedInWith')
                  : t('accountMenu.guestDescription')}
              </p>
            </div>
          </div>
          <div
            id={menuId}
            role="menu"
            aria-labelledby="account-menu-button"
            className="grid"
          >
            {user ? null : (
              <Link
                role="menuitem"
                to="/login"
                className={getButtonClassName({
                  fullWidth: true,
                  className: 'mx-1 mb-2 w-auto'
                })}
                onClick={() => close(false)}
              >
                {t('login')}
              </Link>
            )}
            <div role="separator" className="account-menu-separator" />
            {user ? (
              <>
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
              </>
            ) : null}
            <div
              role="group"
              aria-labelledby={languageId}
              className="flex min-h-11 items-center justify-between gap-3 px-3"
            >
              <span id={languageId} className="text-sm text-muted">
                {t('accountMenu.language')}
              </span>
              <span className="account-menu-segment">
                {UI_LOCALES.map((value) => (
                  <button
                    key={value}
                    role="menuitemradio"
                    type="button"
                    lang={value}
                    aria-checked={locale === value}
                    onClick={() => setLocale(value)}
                  >
                    {commonT(`locale.${value}`)}
                  </button>
                ))}
              </span>
            </div>
            {user ? (
              <>
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
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {user && hasLogout ? (
        <LogoutDialog
          open={logoutOpen}
          onOpenChange={setLogoutOpen}
          returnFocusRef={trigger}
        />
      ) : null}
    </div>
  )
}

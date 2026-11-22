import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { KeyboardEvent, ReactElement, RefObject } from 'react'
import { Avatar } from '@app/account/components/Avatar'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { IconName } from '@nihongo/browser/common/components/Icon'

const ItemIcon = ({ name }: { name: IconName }): ReactElement => (
  <Icon name={name} className="account-menu-item-icon" />
)

const itemClassName = 'account-menu-item account-menu-row'

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
      <div className="account-menu-who">
        <Avatar name={name} size="sm" />
        <div className="account-menu-who-text">
          <p className="account-menu-who-name">{name}</p>
          <p className="account-menu-who-note">
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
        className="account-menu-list"
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

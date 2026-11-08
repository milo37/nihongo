import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { getButtonClassName } from '@nihongo/browser/common/components/Button'

/** A shared link asked a guest for a locked count or mode (U4 L12). */
export const GuestUrlLockedNotice = ({
  loginHref
}: {
  loginHref: string
}): ReactElement => {
  const { t } = useTranslation('practice')
  const { t: authT } = useTranslation('auth')
  return (
    <div className="practice-guest-note" role="status">
      <span>{t('setup.urlLocked')}</span>
      <Link
        className={getButtonClassName({ variant: 'outline', size: 'sm' })}
        to={loginHref}
      >
        {authT('guestToast.login')}
      </Link>
    </div>
  )
}

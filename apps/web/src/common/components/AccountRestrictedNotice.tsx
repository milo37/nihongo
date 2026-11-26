import { useTranslation } from 'react-i18next'
import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'

type AccountRestrictedNoticeProps = {
  className?: string
  /** Move focus here when the notice replaces a failed action. */
  focusOnMount?: boolean
}

export const AccountRestrictedNotice = ({
  className = '',
  focusOnMount = false
}: AccountRestrictedNoticeProps): ReactElement => {
  const { t } = useTranslation('common')
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (focusOnMount) ref.current?.focus()
  }, [focusOnMount])
  return (
    <p
      ref={ref}
      className={`account-restricted-notice ${className}`}
      role="alert"
      tabIndex={focusOnMount ? -1 : undefined}
    >
      {t('state.accountRestricted')}
    </p>
  )
}

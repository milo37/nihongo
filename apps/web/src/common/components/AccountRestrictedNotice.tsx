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
      className={`rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${className}`}
      role="alert"
      tabIndex={focusOnMount ? -1 : undefined}
    >
      {t('state.accountRestricted')}
    </p>
  )
}

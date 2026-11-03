import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'

type AccountRestrictedNoticeProps = {
  className?: string
}

export const AccountRestrictedNotice = ({
  className = ''
}: AccountRestrictedNoticeProps): ReactElement => {
  const { t } = useTranslation('common')
  return (
    <p
      className={`rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-950 ${className}`}
      role="alert"
    >
      {t('state.accountRestricted')}
    </p>
  )
}

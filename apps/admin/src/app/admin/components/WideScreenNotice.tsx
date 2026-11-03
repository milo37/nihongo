import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import type { ReactElement } from 'react'

export const WideScreenNotice = (): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <p className="mb-6 rounded-sm border border-line bg-brand-soft px-4 py-3 text-sm leading-6 lg:hidden">
      {t('common.wideScreenRecommended')}
    </p>
  )
}

import type { ReactElement } from 'react'
import type { ReportStatus } from '@nihongo/contracts/report/reports'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { IconName } from '@nihongo/browser/common/components/Icon'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

// Status differs from the kind badge by icon, text and tone, never colour alone.
const appearance: Record<
  ReportStatus,
  { variant: 'warning' | 'success' | 'neutral'; icon: IconName }
> = {
  RECEIVED: { variant: 'warning', icon: 'circle-alert' },
  ANSWERED: { variant: 'success', icon: 'circle-check' },
  CLOSED: { variant: 'neutral', icon: 'check' }
}

export const ReportStatusBadge = ({
  status
}: {
  status: ReportStatus
}): ReactElement => {
  const { t } = useAdminPresentation()
  const { variant, icon } = appearance[status]
  return (
    <Badge variant={variant} className="gap-1">
      <Icon name={icon} className="size-3.5 shrink-0" />
      {t(`userReport.statuses.${status}`)}
    </Badge>
  )
}

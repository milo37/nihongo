import type { ReactElement } from 'react'
import type { AdminMemberStatus } from '@nihongo/contracts/admin/members'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

export const MemberStatusBadge = ({
  status
}: {
  readonly status: AdminMemberStatus
}): ReactElement => {
  const { t } = useAdminPresentation()
  const active = status === 'ACTIVE'
  return (
    <Badge
      variant={active ? 'success' : 'danger'}
      className="inline-flex items-center gap-1 whitespace-nowrap"
    >
      <Icon
        name={active ? 'circle-check' : 'circle-alert'}
        className="size-3.5 shrink-0"
      />
      {t(`members.status.${status}`)}
    </Badge>
  )
}

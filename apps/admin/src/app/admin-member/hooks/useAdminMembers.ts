import { useQuery } from '@tanstack/react-query'
import type { ListAdminMembersQuery } from '@nihongo/contracts/admin/members'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { captureAuthTransitionEpoch } from '@nihongo/browser/libs/authTransitionFence'
import { adminMemberQueries } from '@app/admin-member/queries/adminMemberQueries'

export const useAdminMembersList = (query: ListAdminMembersQuery) => {
  const { user, role, isReady } = useAuth()
  const epoch = captureAuthTransitionEpoch()
  return useQuery({
    ...adminMemberQueries.list(user?.id ?? null, epoch, query),
    enabled: isReady && role === 'ADMIN' && Boolean(user?.id),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === user?.id &&
      previousQuery?.queryKey[3] === epoch
        ? previous
        : undefined
  })
}

export const useAdminMemberDetail = (memberId: string) => {
  const { user, role, isReady } = useAuth()
  const epoch = captureAuthTransitionEpoch()
  return useQuery({
    ...adminMemberQueries.detail(user?.id ?? null, epoch, memberId),
    enabled: isReady && role === 'ADMIN' && Boolean(user?.id)
  })
}

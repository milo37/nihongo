import {
  onlineManager,
  useMutation,
  useQueryClient
} from '@tanstack/react-query'
import type { AdminMemberDetail } from '@nihongo/contracts/admin/members'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthActorTransitionFence,
  captureAuthActorTransitionFence,
  type AuthActorTransitionFence
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import {
  adminMemberMutations,
  adminMemberQueries
} from '@app/admin-member/queries/adminMemberQueries'
import { adminAuditQueries } from '@app/admin-audit/queries/adminAuditQueries'

const offlineError = () =>
  Object.assign(new Error('Offline command refused'), { isOffline: true })
const bind = (): AuthActorTransitionFence => {
  if (!onlineManager.isOnline()) throw offlineError()
  const actor = useAppStore.getState().currentUser
  if (actor?.role !== 'ADMIN') throw new AuthTransitionSupersededError()
  return captureAuthActorTransitionFence(actor)
}
const assertAdmin = (fence: AuthActorTransitionFence | undefined): void => {
  if (!fence || fence.role !== 'ADMIN')
    throw new AuthTransitionSupersededError()
  assertCurrentAuthActorTransitionFence(
    fence,
    useAppStore.getState().currentUser
  )
}

const useMemberCommand = <Input>(
  options: {
    mutationKey: readonly unknown[]
    mutationFn: (input: Input) => Promise<AdminMemberDetail>
  },
  onSuccess: (member: AdminMemberDetail) => void
) => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: options.mutationKey,
    retry: false,
    networkMode: 'always',
    scope: { id: 'admin-member-command' },
    onMutate: bind,
    mutationFn: (input: Input) => {
      if (!onlineManager.isOnline()) throw offlineError()
      return options.mutationFn(input)
    },
    onSuccess: async (member, _input, fence) => {
      assertAdmin(fence)
      await Promise.all(
        [adminMemberQueries.allKey(), adminAuditQueries.allKey()].map(
          (queryKey) => client.invalidateQueries({ queryKey })
        )
      )
      assertAdmin(fence)
      onSuccess(member)
    }
  })
}

export const useRestrictAdminMember = (
  memberId: string,
  onSuccess: (member: AdminMemberDetail) => void
) => useMemberCommand(adminMemberMutations.restrict(memberId), onSuccess)

export const useReleaseAdminMemberRestriction = (
  memberId: string,
  onSuccess: (member: AdminMemberDetail) => void
) => useMemberCommand(adminMemberMutations.release(memberId), onSuccess)

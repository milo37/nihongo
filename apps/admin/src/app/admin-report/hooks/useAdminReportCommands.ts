import {
  onlineManager,
  useMutation,
  useQueryClient,
  type UseMutationOptions
} from '@tanstack/react-query'
import type {
  AdminReportDetail,
  CloseAdminReportRequest,
  ReplyAndCloseAdminReportRequest,
  SaveAdminReportNoteRequest
} from '@nihongo/contracts/admin/reports'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthActorTransitionFence,
  captureAuthActorTransitionFence,
  type AuthActorTransitionFence
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import {
  adminReportMutations,
  adminReportQueries
} from '@app/admin-report/queries/adminReportQueries'
import { adminAuditQueries } from '@app/admin-audit/queries/adminAuditQueries'

const dispatchFences = new WeakMap<object, AuthActorTransitionFence>()
const offline = (): Error =>
  Object.assign(new Error('Offline command refused'), { isOffline: true })
const bind = (input: object): AuthActorTransitionFence => {
  if (!onlineManager.isOnline()) throw offline()
  const actor = useAppStore.getState().currentUser
  if (actor?.role !== 'ADMIN') throw new AuthTransitionSupersededError()
  const fence = captureAuthActorTransitionFence(actor)
  dispatchFences.set(input, fence)
  return fence
}
const assertAdmin = (fence: AuthActorTransitionFence | undefined): void => {
  if (!fence || fence.role !== 'ADMIN')
    throw new AuthTransitionSupersededError()
  assertCurrentAuthActorTransitionFence(
    fence,
    useAppStore.getState().currentUser
  )
}

type CommandCallbacks = {
  onSuccess?: (report: AdminReportDetail) => void
  onError?: (error: unknown) => void
}

// All three commands share one scope so they never run concurrently.
const useReportCommand = <Body extends object>(
  options: UseMutationOptions<AdminReportDetail, Error, Body>,
  { onSuccess, onError }: CommandCallbacks
) => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: options.mutationKey,
    retry: false,
    networkMode: 'always',
    scope: { id: 'admin-report-command' },
    onMutate: bind,
    mutationFn: (input: Body, context) => {
      assertAdmin(dispatchFences.get(input))
      if (!onlineManager.isOnline()) throw offline()
      return options.mutationFn!(input, context)
    },
    onSuccess: async (report, _input, fence) => {
      assertAdmin(fence)
      await Promise.all([
        client.invalidateQueries({ queryKey: adminReportQueries.allKey() }),
        client.invalidateQueries({ queryKey: adminAuditQueries.allKey() })
      ])
      assertAdmin(fence)
      onSuccess?.(report)
    },
    onError: (error, _input, fence) => {
      try {
        assertAdmin(fence)
      } catch {
        return
      }
      onError?.(error)
    }
  })
}

export const useReplyAndCloseAdminReport = (
  reportId: string,
  callbacks: CommandCallbacks = {}
) =>
  useReportCommand<ReplyAndCloseAdminReportRequest>(
    adminReportMutations.replyAndClose(reportId),
    callbacks
  )

export const useSaveAdminReportNote = (
  reportId: string,
  callbacks: CommandCallbacks = {}
) =>
  useReportCommand<SaveAdminReportNoteRequest>(
    adminReportMutations.note(reportId),
    callbacks
  )

export const useCloseAdminReport = (
  reportId: string,
  callbacks: CommandCallbacks = {}
) =>
  useReportCommand<CloseAdminReportRequest>(
    adminReportMutations.close(reportId),
    callbacks
  )

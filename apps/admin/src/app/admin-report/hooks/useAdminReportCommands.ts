import {
  onlineManager,
  useMutation,
  useQueryClient
} from '@tanstack/react-query'
import type {
  QuestionReportMutationResult,
  ResolveAdminQuestionReportRequest,
  TriageAdminQuestionReportRequest
} from '@nihongo/contracts/admin/phase7'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthActorTransitionFence,
  captureAuthActorTransitionFence,
  type AuthActorTransitionFence
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'
import {
  adminReportMutations,
  adminReportQueries
} from '@app/admin-report/queries/adminReportQueries'
import { adminAuditQueries } from '@app/admin-audit/queries/adminAuditQueries'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'

const dispatchFences = new WeakMap<object, AuthActorTransitionFence>()
const bind = (input: object): AuthActorTransitionFence => {
  if (!onlineManager.isOnline())
    throw Object.assign(new Error('Offline command refused'), {
      isOffline: true
    })
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
type Status = QuestionReportMutationResult['status']
export const useTriageAdminReport = (
  reportId: string,
  onSuccess?: (status: Status) => void,
  onError?: (error: unknown) => void
) => {
  const client = useQueryClient()
  const options = adminReportMutations.triage(reportId)
  return useMutation({
    ...options,
    retry: false,
    networkMode: 'always',
    scope: { id: 'admin-report-command' },
    onMutate: bind,
    mutationFn: (input: TriageAdminQuestionReportRequest, context) => {
      assertAdmin(dispatchFences.get(input))
      if (!onlineManager.isOnline())
        throw Object.assign(new Error('Offline command refused'), {
          isOffline: true
        })
      return options.mutationFn!(input, context)
    },
    onSuccess: async (result, _input, fence) => {
      assertAdmin(fence)
      await Promise.all([
        client.invalidateQueries({ queryKey: adminReportQueries.allKey() }),
        client.invalidateQueries({ queryKey: adminAuditQueries.allKey() })
      ])
      assertAdmin(fence)
      onSuccess?.(result.status)
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
export const useResolveAdminReport = (
  reportId: string,
  onSuccess?: (status: Status) => void,
  onError?: (error: unknown) => void
) => {
  const client = useQueryClient()
  const options = adminReportMutations.resolve(reportId)
  return useMutation({
    ...options,
    retry: false,
    networkMode: 'always',
    scope: { id: 'admin-report-command' },
    onMutate: bind,
    mutationFn: (input: ResolveAdminQuestionReportRequest, context) => {
      assertAdmin(dispatchFences.get(input))
      if (!onlineManager.isOnline())
        throw Object.assign(new Error('Offline command refused'), {
          isOffline: true
        })
      return options.mutationFn!(input, context)
    },
    onSuccess: async (result, _input, fence) => {
      assertAdmin(fence)
      await Promise.all(
        [
          adminReportQueries.allKey(),
          adminAuditQueries.allKey(),
          adminQuestionQueries.allKey(),
          serverStateQueryKeys.bookmark.all(),
          serverStateQueryKeys.wrongNote.all(),
          serverStateQueryKeys.dashboard.all()
        ].map((queryKey) => client.invalidateQueries({ queryKey }))
      )
      assertAdmin(fence)
      onSuccess?.(result.status)
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

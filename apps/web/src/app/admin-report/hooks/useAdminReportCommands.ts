import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  QuestionReportMutationResult,
  ResolveAdminQuestionReportRequest,
  TriageAdminQuestionReportRequest
} from '@nihongo/contracts/admin/phase7'
import {
  resolvePhase7AdminQuestionReport,
  triagePhase7AdminQuestionReport
} from '@api/phase7/phase7AdminApi'
import { invalidatePhase7AdminMutation } from '@app/admin-question/queries/phase7AdminInvalidation'
import {
  AuthTransitionSupersededError,
  assertCurrentAuthActorTransitionFence,
  captureAuthActorTransitionFence,
  type AuthActorTransitionFence
} from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'
const captureAdmin = (): AuthActorTransitionFence => {
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
type Status = QuestionReportMutationResult['status']
// Bind both dispatch and settlement to the initiating ADMIN, including queued mutations.
const dispatchFences = new WeakMap<object, AuthActorTransitionFence>()
const bind = (input: object): AuthActorTransitionFence => {
  const fence = captureAdmin()
  dispatchFences.set(input, fence)
  return fence
}
export const useTriageAdminReport = (
  reportId: string,
  onSuccess?: (status: Status) => void
) => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['phase7-admin', 'report-triage', reportId],
    networkMode: 'always',
    onMutate: bind,
    mutationFn: (request: TriageAdminQuestionReportRequest) => {
      assertAdmin(dispatchFences.get(request))
      return triagePhase7AdminQuestionReport(reportId, request)
    },
    onSuccess: async (result, _input, fence) => {
      assertAdmin(fence)
      await invalidatePhase7AdminMutation(client, {
        kind: 'REPORT_TRIAGE',
        reportId
      })
      assertAdmin(fence)
      onSuccess?.(result.status)
    }
  })
}
export const useResolveAdminReport = (
  reportId: string,
  onSuccess?: (status: Status) => void,
  onError?: (error: unknown) => void
) => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['phase7-admin', 'report-resolution', reportId],
    networkMode: 'always',
    onMutate: bind,
    mutationFn: (request: ResolveAdminQuestionReportRequest) => {
      assertAdmin(dispatchFences.get(request))
      return resolvePhase7AdminQuestionReport(reportId, request)
    },
    onSuccess: async (result, _input, fence) => {
      assertAdmin(fence)
      await invalidatePhase7AdminMutation(client, {
        kind: 'REPORT_RESOLVE',
        reportId,
        questionIds: [result.questionId]
      })
      assertAdmin(fence)
      onSuccess?.(result.status)
    },
    onError: (error, _input, fence) => {
      try {
        assertAdmin(fence)
      } catch (cause) {
        if (cause instanceof AuthTransitionSupersededError) return
        throw cause
      }
      onError?.(error)
    }
  })
}

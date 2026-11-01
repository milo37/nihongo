import type { AdminQuestionMutationResult } from '@nihongo/contracts/admin/content-operations'
import {
  onlineManager,
  useMutation,
  useQueryClient
} from '@tanstack/react-query'
import {
  AuthTransitionSupersededError,
  captureAuthActorTransitionFence,
  assertCurrentAuthActorTransitionFence,
  type AuthActorTransitionFence
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'
import { adminAuditQueries } from '@app/admin-audit/queries/adminAuditQueries'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'
import {
  questionWorkflowMutations,
  questionWorkflowQueries
} from '@app/admin-question/queries/questionWorkflowQueries'
import type { QuestionWrite } from '@app/admin-question/detail/questionWorkflow'
const fences = new WeakMap<object, AuthActorTransitionFence>()
const assertAdmin = (fence: AuthActorTransitionFence | undefined): void => {
  if (!fence || fence.role !== 'ADMIN')
    throw new AuthTransitionSupersededError()
  assertCurrentAuthActorTransitionFence(
    fence,
    useAppStore.getState().currentUser
  )
}
const assertOnline = (): void => {
  if (!onlineManager.isOnline())
    throw Object.assign(new Error('Offline command refused'), {
      isOffline: true
    })
}
export const useQuestionCommands = (
  onSuccess: (
    result: AdminQuestionMutationResult,
    request: QuestionWrite
  ) => void,
  onError?: (error: unknown) => void
) => {
  const client = useQueryClient()
  const options = questionWorkflowMutations.command()
  return useMutation({
    ...options,
    retry: false,
    networkMode: 'always',
    scope: { id: 'question-workflow-command' },
    onMutate: (request: QuestionWrite) => {
      assertOnline()
      const actor = useAppStore.getState().currentUser
      if (actor?.role !== 'ADMIN') throw new AuthTransitionSupersededError()
      const fence = captureAuthActorTransitionFence(actor)
      fences.set(request, fence)
      return fence
    },
    mutationFn: (request: QuestionWrite, context) => {
      assertAdmin(fences.get(request))
      assertOnline()
      return options.mutationFn!(request, context)
    },
    onSuccess: async (_result, _input, fence) => {
      assertAdmin(fence)
      await Promise.all(
        [
          questionWorkflowQueries.allKey(),
          adminQuestionQueries.allKey(),
          adminAuditQueries.allKey(),
          serverStateQueryKeys.bookmark.all(),
          serverStateQueryKeys.wrongNote.all(),
          serverStateQueryKeys.dashboard.all()
        ].map((queryKey) => client.invalidateQueries({ queryKey }))
      )
      assertAdmin(fence)
      onSuccess(_result, _input)
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

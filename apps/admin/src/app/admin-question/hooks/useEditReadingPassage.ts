import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AuthTransitionSupersededError,
  captureAuthActorTransitionFence
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import {
  requestContentOperation,
  type ContentOperationRequest
} from '@nihongo/browser/api/content-operations/requestContentOperation'
import { adminAuditQueries } from '@app/admin-audit/queries/adminAuditQueries'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'
import { questionWorkflowQueries } from '@app/admin-question/queries/questionWorkflowQueries'
import {
  assertAdmin,
  assertOnline
} from '@app/admin-question/hooks/useQuestionCommands'

type EditReadingPassage = ContentOperationRequest<'editReadingPassage'>

/**
 * #1196: one passage edit for every question sharing it. The server makes a
 * draft per question; the question caches reload so each shows its draft.
 * Same admin fence and online check as the question commands.
 */
export const useEditReadingPassage = () => {
  const client = useQueryClient()
  const reload = () =>
    Promise.all(
      [
        questionWorkflowQueries.allKey(),
        adminQuestionQueries.allKey(),
        adminAuditQueries.allKey()
      ].map((queryKey) => client.invalidateQueries({ queryKey }))
    )
  return useMutation({
    mutationKey: [...questionWorkflowQueries.allKey(), 'edit-reading-passage'],
    retry: false,
    networkMode: 'always',
    scope: { id: 'question-workflow-command' },
    // The shared passage block shows every refusal itself; the app banner
    // would stay on after the next save succeeds.
    meta: { localErrorUi: true },
    onMutate: () => {
      assertOnline()
      const actor = useAppStore.getState().currentUser
      if (actor?.role !== 'ADMIN') throw new AuthTransitionSupersededError()
      return captureAuthActorTransitionFence(actor)
    },
    mutationFn: (request: EditReadingPassage) => {
      assertOnline()
      return requestContentOperation(request)
    },
    onSuccess: async (_result, _request, fence) => {
      assertAdmin(fence)
      await reload()
    },
    // A refusal (open version, changed row version) means the group shown is
    // stale, so it reloads too.
    onError: () => void reload()
  })
}

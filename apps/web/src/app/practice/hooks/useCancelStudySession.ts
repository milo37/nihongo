import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  assertCurrentCancelStudySessionAction,
  studyDraftMutations,
  type CancelStudySessionMutationInput
} from '@app/practice/queries/studyDraftQueries'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { clearStudyDraftWorkingCopy } from '@app/practice/draft/studyDraftWorkingCopyStorage'

export const useCancelStudySession = (principalScope: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...studyDraftMutations.cancel(),
    onSuccess: async (_response, input: CancelStudySessionMutationInput) => {
      assertCurrentCancelStudySessionAction(input)
      queryClient.removeQueries({
        queryKey: serverStateQueryKeys.study.draft(input.sessionId),
        exact: true
      })
      clearStudyDraftWorkingCopy(principalScope, input.sessionId)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: serverStateQueryKeys.study.session(input.sessionId)
        }),
        queryClient.invalidateQueries({
          queryKey: serverStateQueryKeys.study.sessions()
        })
      ])
      assertCurrentCancelStudySessionAction(input)
    }
  })
}

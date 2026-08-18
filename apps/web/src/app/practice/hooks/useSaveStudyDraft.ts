import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  assertCurrentSaveStudyDraftAction,
  studyDraftMutations,
  type SaveStudyDraftMutationInput
} from '@app/practice/queries/studyDraftQueries'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'

export const useSaveStudyDraft = (sessionId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...studyDraftMutations.save(sessionId),
    onSuccess: async (response, input: SaveStudyDraftMutationInput) => {
      assertCurrentSaveStudyDraftAction(input)
      await queryClient.invalidateQueries({
        queryKey: serverStateQueryKeys.study.sessions(),
        refetchType: 'none'
      })
      assertCurrentSaveStudyDraftAction(input)
    }
  })
}

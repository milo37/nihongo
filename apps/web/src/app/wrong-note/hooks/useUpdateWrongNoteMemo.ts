import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  assertCurrentMemoAction,
  wrongNoteMutations
} from '@app/wrong-note/queries/wrongNoteMutations'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import { serverStateQueryKeys } from '@libs/serverStateQueryKeys'

export const useUpdateWrongNoteMemo = (questionId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...wrongNoteMutations.updateMemo(questionId),
    onSuccess: async (data, input) => {
      assertCurrentMemoAction(input)
      queryClient.setQueryData(wrongNoteQueries.memo(questionId).queryKey, data)
      await queryClient.invalidateQueries({
        queryKey: serverStateQueryKeys.wrongNote.reviewQueues()
      })
      assertCurrentMemoAction(input)
    }
  })
}

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  assertCurrentUpdateWrongNoteMemoAction,
  legacyWrongNoteMutations
} from '@app/wrong-note/queries/legacyWrongNoteMutations'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import { toLegacyWrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'

export const useUpdateWrongNoteMemo = (questionId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...legacyWrongNoteMutations.updateMemo(questionId),
    onSuccess: async (data, input) => {
      assertCurrentUpdateWrongNoteMemoAction(input)
      await queryClient.invalidateQueries({
        queryKey: wrongNoteQueries.allKey()
      })
      assertCurrentUpdateWrongNoteMemoAction(input)
      queryClient.setQueryData(
        wrongNoteQueries.detail(questionId).queryKey,
        toLegacyWrongNoteDetailView(data)
      )
    }
  })
}

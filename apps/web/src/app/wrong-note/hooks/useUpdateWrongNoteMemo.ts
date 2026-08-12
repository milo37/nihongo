import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  wrongNoteMutations,
  wrongNoteQueries
} from '@app/wrong-note/queries/wrongNoteQueries'

export const useUpdateWrongNoteMemo = (questionId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...wrongNoteMutations.updateMemo(questionId),
    onSuccess: (data) => {
      queryClient.setQueryData(
        wrongNoteQueries.detail(questionId).queryKey,
        data
      )
      return queryClient.invalidateQueries({
        queryKey: wrongNoteQueries.allKey()
      })
    }
  })
}

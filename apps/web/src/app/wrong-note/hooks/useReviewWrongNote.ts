import { useMutation, useQueryClient } from '@tanstack/react-query'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import {
  assertCurrentReviewWrongNoteAction,
  legacyWrongNoteMutations
} from '@app/wrong-note/queries/legacyWrongNoteMutations'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

export const useReviewWrongNote = (questionId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...legacyWrongNoteMutations.review(questionId),
    onSuccess: async (_data, input) => {
      assertCurrentReviewWrongNoteAction(input)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: wrongNoteQueries.allKey()
        }),
        queryClient.invalidateQueries({
          queryKey: dashboardQueries.allKey()
        })
      ])
      assertCurrentReviewWrongNoteAction(input)
    }
  })
}

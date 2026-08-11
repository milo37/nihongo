import { useMutation, useQueryClient } from '@tanstack/react-query'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import {
  wrongNoteMutations,
  wrongNoteQueries
} from '@app/wrong-note/queries/wrongNoteQueries'

export const useReviewWrongNote = (questionId: string) => {
  const queryClient = useQueryClient()

  return useMutation({
    ...wrongNoteMutations.review(questionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: wrongNoteQueries.allKey()
      })
      void queryClient.invalidateQueries({
        queryKey: dashboardQueries.allKey()
      })
    }
  })
}

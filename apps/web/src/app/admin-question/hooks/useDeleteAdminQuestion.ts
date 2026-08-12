import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  adminQuestionMutations,
  adminQuestionQueries
} from '@app/admin-question/queries/adminQuestionQueries'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

export const useDeleteAdminQuestion = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...adminQuestionMutations.delete(),
    onSuccess: ({ questionId }) => {
      queryClient.removeQueries({
        queryKey: adminQuestionQueries.detail(questionId).queryKey
      })
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminQuestionQueries.allKey()
        }),
        queryClient.invalidateQueries({ queryKey: bookmarkQueries.allKey() }),
        queryClient.invalidateQueries({ queryKey: wrongNoteQueries.allKey() }),
        queryClient.invalidateQueries({ queryKey: dashboardQueries.allKey() })
      ])
    }
  })
}

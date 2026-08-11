import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  adminQuestionMutations,
  adminQuestionQueries
} from '@app/admin-question/queries/adminQuestionQueries'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

export const useUpdateAdminQuestion = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...adminQuestionMutations.update(),
    onSuccess: (data) => {
      queryClient.setQueryData(
        adminQuestionQueries.detail(data.id).queryKey,
        data
      )
      void Promise.all([
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

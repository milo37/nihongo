import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isApiError } from '@api/config'
import { serverStateQueryKeys } from '@libs/serverStateQueryKeys'
import {
  adminQuestionMutations,
  adminQuestionQueries
} from '@app/admin-question/queries/adminQuestionQueries'

export const useDeleteAdminQuestion = () => {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    ...adminQuestionMutations.delete(),
    onSuccess: ({ questionId }) => {
      queryClient.removeQueries({
        queryKey: adminQuestionQueries.detail(questionId).queryKey
      })
      queryClient.removeQueries({
        queryKey: [...adminQuestionQueries.allKey(), 'preview', questionId]
      })
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminQuestionQueries.allKey()
        }),
        queryClient.invalidateQueries({
          queryKey: bookmarkQueries.allKey()
        }),
        queryClient.invalidateQueries({
          queryKey: serverStateQueryKeys.wrongNote.all()
        }),
        queryClient.invalidateQueries({
          queryKey: serverStateQueryKeys.dashboard.all()
        })
      ])
    }
  })

  return {
    ...mutation,
    apiError: isApiError(mutation.error) ? mutation.error : null
  }
}

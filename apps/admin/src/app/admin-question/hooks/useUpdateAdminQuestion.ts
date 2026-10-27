import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isApiError } from '@nihongo/browser/api/config'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'
import {
  adminQuestionMutations,
  adminQuestionQueries
} from '@app/admin-question/queries/adminQuestionQueries'

export const useUpdateAdminQuestion = () => {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    ...adminQuestionMutations.update(),
    onSuccess: () => {
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: adminQuestionQueries.allKey()
        }),
        queryClient.invalidateQueries({
          queryKey: serverStateQueryKeys.bookmark.all()
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

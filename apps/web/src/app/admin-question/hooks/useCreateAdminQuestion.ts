import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  adminQuestionMutations,
  adminQuestionQueries
} from '@app/admin-question/queries/adminQuestionQueries'

export const useCreateAdminQuestion = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...adminQuestionMutations.create(),
    onSuccess: () => {
      return queryClient.invalidateQueries({
        queryKey: adminQuestionQueries.allKey()
      })
    }
  })
}

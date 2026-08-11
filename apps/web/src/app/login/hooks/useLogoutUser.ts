import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authMutations } from '@app/login/queries/authMutations'

export const useLogoutUser = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...authMutations.logout(),
    onSuccess: () => {
      queryClient.removeQueries()
    }
  })
}

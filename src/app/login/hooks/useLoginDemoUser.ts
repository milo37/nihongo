import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authMutations } from '@app/login/queries/authMutations'

export const useLoginDemoUser = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...authMutations.loginDemoUser(),
    onSuccess: () => {
      queryClient.removeQueries()
    }
  })
}

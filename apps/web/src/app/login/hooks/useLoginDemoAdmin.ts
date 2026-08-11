import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authMutations } from '@app/login/queries/authMutations'

export const useLoginDemoAdmin = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...authMutations.loginDemoAdmin(),
    onSuccess: () => {
      queryClient.removeQueries()
    }
  })
}

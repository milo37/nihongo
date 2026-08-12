import { useMutation, useQueryClient } from '@tanstack/react-query'
import { commitCanonicalAuth } from '@app/login/authSession'
import { authMutations } from '@app/login/queries/authMutations'

export const useLogoutUser = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...authMutations.logout(),
    onSuccess: () => {
      return commitCanonicalAuth(queryClient, null, {
        forceClear: true,
        forcePracticeReset: true
      })
    }
  })
}

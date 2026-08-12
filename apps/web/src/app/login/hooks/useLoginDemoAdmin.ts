import { useMutation, useQueryClient } from '@tanstack/react-query'
import { commitCanonicalAuth } from '@app/login/authSession'
import { authMutations } from '@app/login/queries/authMutations'

export const useLoginDemoAdmin = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...authMutations.loginDemoAdmin(),
    onSuccess: (user) => {
      return commitCanonicalAuth(queryClient, user, {
        forceClear: true,
        forcePracticeReset: true
      })
    }
  })
}

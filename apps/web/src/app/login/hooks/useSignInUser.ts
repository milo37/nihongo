import { useMutation, useQueryClient } from '@tanstack/react-query'
import { refreshCanonicalAuthAfterMutation } from '@app/login/authSession'
import { authMutations } from '@app/login/queries/authMutations'

export const useSignInUser = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...authMutations.signIn(),
    onSuccess: async () => {
      return refreshCanonicalAuthAfterMutation(queryClient, {
        expectedIdentity: 'AUTHENTICATED',
        forceClear: true,
        forcePracticeReset: true
      })
    }
  })
}

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { refreshCanonicalAuthAfterMutation } from '@app/login/authSession'
import { authMutations } from '@app/login/queries/authMutations'

export const useLogoutUser = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...authMutations.logout(),
    onSuccess: async () => {
      return refreshCanonicalAuthAfterMutation(queryClient, {
        expectedIdentity: 'GUEST',
        forceClear: true,
        forcePracticeReset: true
      })
    }
  })
}

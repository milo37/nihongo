import { useMutation, useQueryClient } from '@tanstack/react-query'
import { refreshCanonicalAuthAfterMutation } from '@app/login/authSession'
import { authMutations } from '@app/login/queries/authMutations'

export const useResetPassword = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...authMutations.resetPassword(),
    onSuccess: async () =>
      refreshCanonicalAuthAfterMutation(queryClient, {
        expectedIdentity: 'GUEST',
        forceClear: true,
        forcePracticeReset: true
      })
  })
}

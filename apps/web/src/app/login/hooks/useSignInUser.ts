import { useMutation, useQueryClient } from '@tanstack/react-query'
import { refreshCanonicalAuthAfterMutation } from '@app/login/authSession'
import { authMutations } from '@app/login/queries/authMutations'
import { analyticsClient } from '@/analytics/client'

export const useSignInUser = () => {
  const queryClient = useQueryClient()

  return useMutation({
    ...authMutations.signIn(),
    onSuccess: async () => {
      const refresh = await refreshCanonicalAuthAfterMutation(queryClient, {
        expectedIdentity: 'AUTHENTICATED',
        forceClear: true,
        forcePracticeReset: true
      })
      if (refresh.applied) {
        analyticsClient.track({ event: 'login', payload: {} })
      }
      return refresh
    }
  })
}

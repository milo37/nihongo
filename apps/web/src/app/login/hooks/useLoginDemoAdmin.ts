import { useMutation, useQueryClient } from '@tanstack/react-query'
import { refreshCanonicalAuthAfterMutation } from '@app/login/authSession'
import { authMutations } from '@app/login/queries/authMutations'
import { isMockApiMode } from '@libs/apiMode'

export const useLoginDemoAdmin = () => {
  const queryClient = useQueryClient()
  const signIn = authMutations.signIn()

  return useMutation({
    mutationKey: signIn.mutationKey,
    networkMode: signIn.networkMode,
    mutationFn: (_input: void, context) => {
      if (!isMockApiMode) {
        throw new Error('Demo sign-in is only available in mock mode.')
      }
      if (!signIn.mutationFn) {
        throw new Error('The canonical sign-in mutation is unavailable.')
      }
      return signIn.mutationFn(
        { email: 'admin@example.com', password: 'Demo-admin-2026!' },
        context
      )
    },
    onSuccess: () =>
      refreshCanonicalAuthAfterMutation(queryClient, {
        expectedIdentity: 'AUTHENTICATED',
        forceClear: true,
        forcePracticeReset: true
      })
  })
}

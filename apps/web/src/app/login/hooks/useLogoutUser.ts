import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { AuthFlowError } from '@app/login/authFlowErrors'
import {
  commitCanonicalAuth,
  refreshCanonicalAuthAfterMutation
} from '@app/login/authSession'
import { authQueries } from '@app/login/queries/authQueries'
import { authMutations } from '@app/login/queries/authMutations'

export const useLogoutUser = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const logout = useMutation({
    ...authMutations.logout(),
    onSuccess: async () => {
      try {
        const confirmed = await refreshCanonicalAuthAfterMutation(queryClient, {
          expectedIdentity: 'GUEST',
          forceClear: true,
          forcePracticeReset: true
        })
        if (confirmed.applied) {
          await navigate('/practice', {
            replace: true,
            state: { signedOut: true }
          })
        }
      } catch (error: unknown) {
        throw new AuthFlowError(error)
      }
    }
  })
  const recheck = useMutation({
    mutationKey: [...authQueries.allKey(), 'confirm-logout'] as const,
    networkMode: 'always',
    mutationFn: async () => {
      try {
        return await queryClient.fetchQuery({
          ...authQueries.currentUser(),
          staleTime: 0
        })
      } catch (error: unknown) {
        throw new AuthFlowError(error)
      }
    },
    onSuccess: async (user) => {
      const confirmed = await commitCanonicalAuth(
        queryClient,
        user,
        user === null ? { forceClear: true, forcePracticeReset: true } : {}
      )
      if (!confirmed.applied) return
      if (user === null) {
        await navigate('/practice', {
          replace: true,
          state: { signedOut: true }
        })
      } else {
        // A fresh canonical USER confirms the sign-out did not complete. A new
        // explicit logout is now allowed; never replay the uncertain command.
        logout.reset()
      }
    }
  })
  return {
    ...logout,
    isPending: logout.isPending || recheck.isPending,
    isError: logout.isError || recheck.isError,
    recheck: () => recheck.mutate()
  }
}

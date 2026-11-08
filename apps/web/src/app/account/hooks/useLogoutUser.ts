import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { AuthFlowError } from '@nihongo/browser/app/login/authFlowErrors'
import {
  commitCanonicalAuth,
  refreshCanonicalAuthAfterMutation
} from '@nihongo/browser/app/login/authSession'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'
import { logoutMutations } from '@app/account/queries/logoutMutations'

export const useLogoutUser = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { t } = useTranslation('auth')
  const { addToast } = useToast()
  const leave = async (): Promise<void> => {
    await navigate('/', { replace: true })
    addToast({ title: t('sso.loggedOut'), variant: 'success' })
  }

  const logout = useMutation({
    ...logoutMutations.logout(),
    onSuccess: async () => {
      try {
        const confirmed = await refreshCanonicalAuthAfterMutation(queryClient, {
          expectedIdentity: 'GUEST',
          forceClear: true,
          forcePracticeReset: true
        })
        if (confirmed.applied) await leave()
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
        await leave()
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

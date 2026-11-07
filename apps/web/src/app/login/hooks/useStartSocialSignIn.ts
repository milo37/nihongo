import { useQueryClient } from '@tanstack/react-query'
import { useAppNavigate } from '@nihongo/browser/libs/appNavigation'
import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
import { refreshCanonicalAuthAfterMutation } from '@nihongo/browser/app/login/authSession'
import { authMutations } from '@app/login/queries/authMutations'
import { useSocialRedirectMutation } from '@app/login/hooks/useSocialRedirectMutation'

export const useStartSocialSignIn = () => {
  const queryClient = useQueryClient()
  const navigate = useAppNavigate()
  return useSocialRedirectMutation(
    authMutations.signInSocial(),
    async (input) => {
      const confirmed = await refreshCanonicalAuthAfterMutation(queryClient, {
        expectedIdentity: 'AUTHENTICATED',
        forceClear: true,
        forcePracticeReset: true
      })
      if (confirmed.applied) {
        await navigate(safeSsoReturnPath(input.callbackURL), { replace: true })
      }
    }
  )
}

import { useQueryClient } from '@tanstack/react-query'
import { useAppNavigate } from '@nihongo/browser/libs/appNavigation'
import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
import { refreshCanonicalAuthAfterMutation } from '@nihongo/browser/app/login/authSession'
import { authMutations } from '@app/login/queries/authMutations'
import { useSocialRedirectMutation } from '@nihongo/browser/app/reauth/hooks/useSocialRedirectMutation'
import { isMockApiMode } from '@nihongo/browser/libs/apiMode'

export const useStartSocialSignIn = () => {
  const queryClient = useQueryClient()
  const navigate = useAppNavigate()
  return useSocialRedirectMutation(
    authMutations.signInSocial(),
    async (input) => {
      // onMock runs only in dev/test MSW mode; production drops this branch.
      if (!__NIHONGO_PRODUCTION_BUILD__ && isMockApiMode) {
        const { takeMockRestoreOffered } = await import(
          '@app/login/mockRestoreMarker'
        )
        if (takeMockRestoreOffered()) {
          const search = new URLSearchParams({
            sso: 'RESTORE_AVAILABLE',
            redirect: safeSsoReturnPath(input.callbackURL)
          })
          await navigate(`/login?${search}`, { replace: true })
          return
        }
      }
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

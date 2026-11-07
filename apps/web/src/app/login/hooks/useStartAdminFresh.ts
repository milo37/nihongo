import { useAppNavigate } from '@nihongo/browser/libs/appNavigation'
import { safeAdminFreshReturnPath } from '@nihongo/contracts/auth/admin-fresh-sso'
import { authMutations } from '@app/login/queries/authMutations'
import { useSocialRedirectMutation } from '@app/login/hooks/useSocialRedirectMutation'

export const useStartAdminFresh = () => {
  const navigate = useAppNavigate()
  return useSocialRedirectMutation(
    authMutations.startAdminFresh(),
    async (input) => {
      // Only a callback hint simulation; no grant/session mutation in MSW.
      const url = new URL(
        safeAdminFreshReturnPath(input.callbackURL),
        window.location.origin
      )
      url.searchParams.set('ssoFresh', 'REAUTHENTICATED')
      await navigate(url.pathname + url.search, { replace: true })
    }
  )
}

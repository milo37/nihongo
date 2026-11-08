import { useHref, useLocation } from 'react-router'
import { safeAdminFreshReturnPath } from '@nihongo/contracts/auth/admin-fresh-sso'
import { getAppPath, useAppNavigate } from '../../../libs/appNavigation'
import { reauthMutations } from '../queries/reauthMutations'
import { useSocialRedirectMutation } from './useSocialRedirectMutation'

/** The query key the server adds to the page an admin returns to. */
export const REAUTH_RETURN_PARAM = 'ssoFresh'

/**
 * Admin re-verification in the same tab: Google sign-in, then back to this
 * page (path and query) with `ssoFresh`. Nothing runs on its own after the
 * return; the admin presses the action again.
 */
export const useStartReauth = () => {
  const location = useLocation()
  const basename = useHref('/')
  const navigate = useAppNavigate()
  const mutation = useSocialRedirectMutation(
    reauthMutations.startAdmin(),
    async (callbackURL) => {
      // MSW has no Google round trip: land where the server would send us.
      const url = new URL(
        safeAdminFreshReturnPath(callbackURL),
        window.location.origin
      )
      url.searchParams.set(REAUTH_RETURN_PARAM, 'REAUTHENTICATED')
      await navigate(url.pathname + url.search, { replace: true })
    }
  )
  const busy = mutation.isPending || mutation.isRedirecting
  /** `returnPath` is a public path such as `/admin/questions?page=2`. */
  const start = (returnPath?: string): void => {
    if (busy) return
    const search = new URLSearchParams(location.search)
    search.delete(REAUTH_RETURN_PARAM)
    const here =
      getAppPath(location.pathname, basename) +
      (search.size ? '?' + search.toString() : '')
    mutation.mutate(safeAdminFreshReturnPath(returnPath ?? here))
  }
  return {
    start,
    busy,
    error: mutation.error,
    reset: mutation.reset
  }
}

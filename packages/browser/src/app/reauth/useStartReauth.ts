import { mutationOptions } from '@tanstack/react-query'
import { useHref, useLocation } from 'react-router'
import { safeAdminFreshReturnPath } from '@nihongo/contracts/auth/admin-fresh-sso'
import { startAdminReauth } from '../../api/auth/startAdminReauth'
import { getAppPath, useAppNavigate } from '../../libs/appNavigation'
import { AuthFlowError } from '../login/authFlowErrors'
import { authQueries } from '../login/queries/authQueries'
import { useSocialRedirectMutation } from './useSocialRedirectMutation'

/** The query key the server adds to the page an admin returns to. */
export const REAUTH_RETURN_PARAM = 'ssoFresh'

const adminReauthMutation = () =>
  mutationOptions({
    mutationKey: [...authQueries.allKey(), 'admin-reauth'] as const,
    networkMode: 'always',
    mutationFn: async (callbackURL: string) => {
      try {
        return await startAdminReauth({
          purpose: 'ADMIN_FRESH',
          provider: 'google',
          callbackURL
        })
      } catch (error: unknown) {
        throw new AuthFlowError(error)
      }
    }
  })

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
    adminReauthMutation(),
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

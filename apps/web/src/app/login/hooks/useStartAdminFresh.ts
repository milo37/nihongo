import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { safeAdminFreshReturnPath } from '@nihongo/contracts/auth/admin-fresh-sso'
import { authMutations } from '@app/login/queries/authMutations'
import { AuthFlowError } from '@app/login/authFlowErrors'
import { socialAuthNavigation } from '@libs/socialAuthNavigation'
import { isMockApiMode } from '@libs/apiMode'

export const useStartAdminFresh = () => {
  const navigate = useNavigate()
  const [isRedirecting, setRedirecting] = useState(false)
  const navigating = useRef(false)
  const mutation = useMutation({
    ...authMutations.startAdminFresh(),
    onSuccess: async (response, input) => {
      try {
        if (!__NIHONGO_PRODUCTION_BUILD__ && isMockApiMode) {
          // Only a callback hint simulation; no grant/session mutation in MSW.
          const url = new URL(
            safeAdminFreshReturnPath(input.callbackURL),
            window.location.origin
          )
          url.searchParams.set('ssoFresh', 'REAUTHENTICATED')
          await navigate(url.pathname + url.search, { replace: true })
          return
        }
        if (navigating.current) return
        navigating.current = true
        setRedirecting(true)
        socialAuthNavigation.assign(response.url)
      } catch (error: unknown) {
        navigating.current = false
        setRedirecting(false)
        throw new AuthFlowError(error)
      }
    }
  })
  const reset = mutation.reset
  useEffect(() => {
    const restore = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        navigating.current = false
        setRedirecting(false)
        reset()
      }
    }
    window.addEventListener('pageshow', restore)
    return () => window.removeEventListener('pageshow', restore)
  }, [reset])
  return { ...mutation, isRedirecting }
}

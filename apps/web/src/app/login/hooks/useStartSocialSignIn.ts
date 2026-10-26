import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppNavigate } from '@nihongo/browser/libs/appNavigation'
import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
import { AuthFlowError } from '@nihongo/browser/app/login/authFlowErrors'
import { refreshCanonicalAuthAfterMutation } from '@nihongo/browser/app/login/authSession'
import { authMutations } from '@app/login/queries/authMutations'
import { isMockApiMode } from '@nihongo/browser/libs/apiMode'
import { socialAuthNavigation } from '@nihongo/browser/libs/socialAuthNavigation'

export const useStartSocialSignIn = () => {
  const queryClient = useQueryClient()
  const navigate = useAppNavigate()
  const [isRedirecting, setRedirecting] = useState(false)
  const navigating = useRef(false)
  const mutation = useMutation({
    ...authMutations.signInSocial(),
    onSuccess: async (response, input) => {
      try {
        if (!__NIHONGO_PRODUCTION_BUILD__ && isMockApiMode) {
          const confirmed = await refreshCanonicalAuthAfterMutation(
            queryClient,
            {
              expectedIdentity: 'AUTHENTICATED',
              forceClear: true,
              forcePracticeReset: true
            }
          )
          if (confirmed.applied) {
            await navigate(safeSsoReturnPath(input.callbackURL), {
              replace: true
            })
          }
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

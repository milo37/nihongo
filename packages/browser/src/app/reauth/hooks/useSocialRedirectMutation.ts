import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'
import { AuthFlowError } from '../../login/authFlowErrors'
import { isMockApiMode } from '../../../libs/apiMode'
import { socialAuthNavigation } from '../../../libs/socialAuthNavigation'

/**
 * Starts an SSO redirect once, keeps the page busy until it leaves, and
 * releases the guard when the browser restores the page from bfcache.
 * `onMock` replaces the external redirect in development/test MSW mode.
 */
export const useSocialRedirectMutation = <
  TResponse extends { readonly url: string },
  TInput
>(
  options: UseMutationOptions<TResponse, Error, TInput>,
  onMock: (input: TInput) => Promise<void>
) => {
  const [isRedirecting, setRedirecting] = useState(false)
  const navigating = useRef(false)
  const mutation = useMutation({
    ...options,
    onSuccess: async (response, input) => {
      try {
        if (!__NIHONGO_PRODUCTION_BUILD__ && isMockApiMode) {
          await onMock(input)
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

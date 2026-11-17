import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiError } from '@nihongo/browser/api/config'
import { refreshCanonicalAuthAfterMutation } from '@nihongo/browser/app/login/authSession'
import { useAppNavigate } from '@nihongo/browser/libs/appNavigation'
import type { AccountRestoreOutcome } from '@app/login/hooks/useAccountRestoreNotice'
import { takeGuestCarryPending } from '@app/login/guestCarryMarker'
import { agreeSignupConsent } from '@api/auth/agreeSignupConsent'
import { cancelSignupConsent } from '@api/auth/cancelSignupConsent'
import { getSignupConsent } from '@api/auth/getSignupConsent'

// The server holds the pending sign-up in a short-lived cookie; no account
// exists until agree.
const STATE_KEY = ['signup-consent'] as const

/** Why the page hands back to the sign-in card. */
export type SignupConsentExit = 'SIGNUP_EXPIRED' | 'FAILED'

// Anything but an expired wait goes back to the sign-in card's failure
// notice; the pending cookie, if still alive, simply expires.
const exitOf = (error: unknown): SignupConsentExit =>
  isApiError(error) && error.code === 'SIGNUP_PENDING_EXPIRED'
    ? 'SIGNUP_EXPIRED'
    : 'FAILED'

/**
 * #1085 r3-4: Google returned an identity without a consent record. Agree
 * creates (or signs in) the account; cancel, or going back, leaves nothing.
 */
export const useSignupConsent = (
  redirect: string,
  onExit: (exit: SignupConsentExit) => void
) => {
  const navigate = useAppNavigate()
  const queryClient = useQueryClient()
  const agree = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: agreeSignupConsent
  })
  const cancel = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: cancelSignupConsent
  })
  const [leaving, setLeaving] = useState(false)
  // Agree spends the pending sign-up; clearing the cache after it must not
  // ask again (that read is a 404).
  const state = useQuery({
    queryKey: STATE_KEY,
    queryFn: getSignupConsent,
    enabled: agree.isIdle && !leaving,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false
  })

  useEffect(() => {
    // No pending sign-up (404) means its 10 minutes passed.
    if (state.isError) onExit(exitOf(state.error))
  }, [onExit, state.error, state.isError])

  const onAgree = (): void => {
    agree.mutate(undefined, {
      onSuccess: async () => {
        queryClient.removeQueries({ queryKey: STATE_KEY })
        const confirmed = await refreshCanonicalAuthAfterMutation(queryClient, {
          expectedIdentity: 'AUTHENTICATED',
          forceClear: true,
          forcePracticeReset: true
        })
        if (!confirmed.applied) {
          onExit('FAILED')
          return
        }
        await navigate(redirect, { replace: true })
      },
      onError: (error) => onExit(exitOf(error))
    })
  }

  const onCancel = (): void => {
    if (leaving) return
    setLeaving(true)
    // The guest's result moves only into an account that now exists.
    takeGuestCarryPending()
    // Nothing is stored either way; a failed cancel just lets it expire.
    cancel.mutate()
    queryClient.removeQueries({ queryKey: STATE_KEY })
    const accountRestore: AccountRestoreOutcome = { kind: 'signupCancelled' }
    void navigate(redirect, { replace: true, state: { accountRestore } })
  }

  return {
    kind: state.data?.kind ?? null,
    isChecking: state.isPending,
    isAgreeing: agree.isPending,
    busy: agree.isPending || leaving,
    onAgree,
    onCancel
  }
}

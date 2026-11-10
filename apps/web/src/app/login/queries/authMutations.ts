import { mutationOptions } from '@tanstack/react-query'
import { signInSocial } from '@api/auth/signInSocial'
import { markGuestCarryPending } from '@app/login/guestCarryMarker'
import type { SignInSocialRequest } from '@api/auth/signInSocial/schema'
import { AuthFlowError } from '@nihongo/browser/app/login/authFlowErrors'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'
import { advanceAuthTransitionEpoch } from '@nihongo/browser/libs/authTransitionFence'
import { isMockApiMode } from '@nihongo/browser/libs/apiMode'

export const authMutations = {
  signInSocial: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'sign-in-social'] as const,
      networkMode: 'always',
      mutationFn: async (input: SignInSocialRequest) => {
        try {
          markGuestCarryPending()
          const response = await signInSocial(input)
          if (!__NIHONGO_PRODUCTION_BUILD__ && isMockApiMode) {
            const { completeMockSocialSignIn } = await import(
              '@api/auth/completeMockSocialSignIn'
            )
            advanceAuthTransitionEpoch()
            await completeMockSocialSignIn(input.provider)
          }
          return response
        } catch (error: unknown) {
          throw new AuthFlowError(error)
        }
      }
    })
} as const

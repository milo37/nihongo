import { mutationOptions } from '@tanstack/react-query'
import { startAdminFresh } from '@api/auth/startAdminFresh'
import { logoutUser } from '@api/auth/logoutUser'
import { signInSocial } from '@api/auth/signInSocial'
import type { SignInSocialRequest } from '@api/auth/signInSocial/schema'
import { AuthFlowError } from '@app/login/authFlowErrors'
import { authQueries } from '@app/login/queries/authQueries'
import { advanceAuthTransitionEpoch } from '@libs/authTransitionFence'
import { isMockApiMode } from '@libs/apiMode'

export const authMutations = {
  startAdminFresh: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'admin-fresh'] as const,
      networkMode: 'always',
      mutationFn: async (input: Parameters<typeof startAdminFresh>[0]) => {
        try {
          return await startAdminFresh(input)
        } catch (error: unknown) {
          throw new AuthFlowError(error)
        }
      }
    }),
  signInSocial: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'sign-in-social'] as const,
      networkMode: 'always',
      mutationFn: async (input: SignInSocialRequest) => {
        try {
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
    }),
  logout: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'logout-user'] as const,
      networkMode: 'always',
      mutationFn: async () => {
        advanceAuthTransitionEpoch()
        try {
          return await logoutUser()
        } catch (error: unknown) {
          throw new AuthFlowError(error)
        }
      }
    })
} as const

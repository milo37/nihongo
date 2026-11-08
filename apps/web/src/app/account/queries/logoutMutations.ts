import { mutationOptions } from '@tanstack/react-query'
import { logoutUser } from '@api/auth/logoutUser'
import { AuthFlowError } from '@nihongo/browser/app/login/authFlowErrors'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'
import { advanceAuthTransitionEpoch } from '@nihongo/browser/libs/authTransitionFence'

// Kept apart from the sign-in mutations: the header account menu needs only
// logout, and loads with every page.
export const logoutMutations = {
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

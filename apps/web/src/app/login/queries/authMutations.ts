import { mutationOptions } from '@tanstack/react-query'
import { logoutUser } from '@api/auth/logoutUser'
import { requestPasswordReset } from '@api/auth/requestPasswordReset'
import { resetPassword } from '@api/auth/resetPassword'
import { signInUser } from '@api/auth/signInUser'
import { signUpUser } from '@api/auth/signUpUser'
import { verifyEmail } from '@api/auth/verifyEmail'
import { authQueries } from '@app/login/queries/authQueries'
import { advanceAuthTransitionEpoch } from '@libs/authTransitionFence'

export const authMutations = {
  signIn: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'sign-in-user'] as const,
      networkMode: 'always',
      mutationFn: (input: Parameters<typeof signInUser>[0]) => {
        advanceAuthTransitionEpoch()
        return signInUser(input)
      }
    }),
  signUp: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'sign-up-user'] as const,
      networkMode: 'always',
      mutationFn: signUpUser
    }),
  requestPasswordReset: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'request-password-reset'] as const,
      networkMode: 'always',
      mutationFn: requestPasswordReset
    }),
  resetPassword: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'reset-password'] as const,
      networkMode: 'always',
      mutationFn: (input: Parameters<typeof resetPassword>[0]) => {
        advanceAuthTransitionEpoch()
        return resetPassword(input)
      }
    }),
  verifyEmail: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'verify-email'] as const,
      networkMode: 'always',
      mutationFn: verifyEmail
    }),
  logout: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'logout-user'] as const,
      networkMode: 'always',
      mutationFn: () => {
        advanceAuthTransitionEpoch()
        return logoutUser()
      }
    })
} as const

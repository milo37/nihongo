import { mutationOptions } from '@tanstack/react-query'
import { logoutUser } from '@api/auth/logoutUser'
import { requestPasswordReset } from '@api/auth/requestPasswordReset'
import { resetPassword } from '@api/auth/resetPassword'
import { signInUser } from '@api/auth/signInUser'
import { signUpUser } from '@api/auth/signUpUser'
import { verifyEmail } from '@api/auth/verifyEmail'
import { authQueries } from '@app/login/queries/authQueries'

export const authMutations = {
  signIn: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'sign-in-user'] as const,
      mutationFn: signInUser
    }),
  signUp: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'sign-up-user'] as const,
      mutationFn: signUpUser
    }),
  requestPasswordReset: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'request-password-reset'] as const,
      mutationFn: requestPasswordReset
    }),
  resetPassword: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'reset-password'] as const,
      mutationFn: resetPassword
    }),
  verifyEmail: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'verify-email'] as const,
      mutationFn: verifyEmail
    }),
  logout: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'logout-user'] as const,
      mutationFn: logoutUser
    })
} as const

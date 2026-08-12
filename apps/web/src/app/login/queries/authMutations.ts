import { mutationOptions } from '@tanstack/react-query'
import { loginDemoAdmin } from '@api/auth/loginDemoAdmin'
import { loginDemoUser } from '@api/auth/loginDemoUser'
import { logoutUser } from '@api/auth/logoutUser'
import { authQueries } from '@app/login/queries/authQueries'

export const authMutations = {
  loginDemoUser: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'login-demo-user'] as const,
      mutationFn: loginDemoUser
    }),
  loginDemoAdmin: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'login-demo-admin'] as const,
      mutationFn: loginDemoAdmin
    }),
  logout: () =>
    mutationOptions({
      mutationKey: [...authQueries.allKey(), 'logout-user'] as const,
      mutationFn: logoutUser
    })
} as const

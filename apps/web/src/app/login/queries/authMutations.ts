import { mutationOptions } from '@tanstack/react-query'
import { loginDemoAdmin } from '@api/auth/loginDemoAdmin'
import { loginDemoUser } from '@api/auth/loginDemoUser'
import { logoutUser } from '@api/auth/logoutUser'

export const authMutations = {
  loginDemoUser: () =>
    mutationOptions({
      mutationKey: ['auth', 'login-demo-user'] as const,
      mutationFn: loginDemoUser
    }),
  loginDemoAdmin: () =>
    mutationOptions({
      mutationKey: ['auth', 'login-demo-admin'] as const,
      mutationFn: loginDemoAdmin
    }),
  logout: () =>
    mutationOptions({
      mutationKey: ['auth', 'logout-user'] as const,
      mutationFn: logoutUser
    })
} as const

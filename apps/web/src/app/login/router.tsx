import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const LoginPage = lazy(() =>
  import('@app/login/page').then((module) => ({ default: module.LoginPage }))
)
const LegacyAuthRedirect = lazy(() =>
  import('@app/login/legacy-auth-redirect').then((module) => ({
    default: module.LegacyAuthRedirect
  }))
)

export const loginRoutes: RouteObject[] = [
  { path: 'login', element: <LoginPage /> },
  { path: 'reset-password', element: <LegacyAuthRedirect /> },
  { path: 'verify-email', element: <LegacyAuthRedirect /> }
]

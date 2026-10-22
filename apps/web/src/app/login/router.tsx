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

const AccountDataPage = lazy(() =>
  import('@app/login/account-data-page').then((module) => ({
    default: module.AccountDataPage
  }))
)
export const loginRoutes: RouteObject[] = [
  { path: 'account/data', element: <AccountDataPage /> },
  { path: 'login', element: <LoginPage /> },
  { path: 'reset-password', element: <LegacyAuthRedirect /> },
  { path: 'verify-email', element: <LegacyAuthRedirect /> }
]

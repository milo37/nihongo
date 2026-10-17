import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const LoginPage = lazy(() =>
  import('@app/login/page').then((module) => ({ default: module.LoginPage }))
)
const ResetPasswordPage = lazy(() =>
  import('@app/login/reset-password-page').then((module) => ({
    default: module.ResetPasswordPage
  }))
)
const VerifyEmailPage = lazy(() =>
  import('@app/login/verify-email-page').then((module) => ({
    default: module.VerifyEmailPage
  }))
)

export const loginRoutes: RouteObject[] = [
  {
    path: 'login',
    element: <LoginPage />
  },
  {
    path: 'reset-password',
    element: <ResetPasswordPage />
  },
  {
    path: 'verify-email',
    element: <VerifyEmailPage />
  }
]

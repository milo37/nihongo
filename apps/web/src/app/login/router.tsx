import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const LoginPage = lazy(() =>
  import('@app/login/page').then((module) => ({ default: module.LoginPage }))
)
const OnboardingPage = lazy(() =>
  import('@app/login/page').then((module) => ({
    default: module.OnboardingPage
  }))
)
const LegacyAuthRedirect = lazy(() =>
  import('@app/login/legacy-auth-redirect').then((module) => ({
    default: module.LegacyAuthRedirect
  }))
)
export const loginRoutes: RouteObject[] = [
  { path: 'login', element: <LoginPage /> },
  { path: 'onboarding', element: <OnboardingPage /> },
  { path: 'reset-password', element: <LegacyAuthRedirect /> },
  { path: 'verify-email', element: <LegacyAuthRedirect /> }
]

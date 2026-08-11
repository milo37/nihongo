import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const LoginPage = lazy(() =>
  import('@app/login/page').then((module) => ({ default: module.LoginPage }))
)

export const loginRoutes: RouteObject[] = [
  {
    path: 'login',
    element: <LoginPage />
  }
]

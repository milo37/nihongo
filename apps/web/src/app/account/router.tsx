import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const AccountPage = lazy(() =>
  import('@app/account/page').then((module) => ({
    default: module.AccountPage
  }))
)
const AccountDataPage = lazy(() =>
  import('@app/account/data-page').then((module) => ({
    default: module.AccountDataPage
  }))
)

export const accountRoutes: RouteObject[] = [
  { path: 'account', element: <AccountPage /> },
  { path: 'account/data', element: <AccountDataPage /> }
]

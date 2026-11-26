import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const AdminRetentionPage = lazy(() =>
  import('@app/admin-retention/page').then((module) => ({
    default: module.AdminRetentionPage
  }))
)

export const adminRetentionRoutes: RouteObject[] = [
  { path: 'retention', element: <AdminRetentionPage /> }
]

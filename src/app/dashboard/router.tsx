import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const DashboardPage = lazy(() =>
  import('@app/dashboard/page').then((module) => ({
    default: module.DashboardPage
  }))
)

export const dashboardRoutes: RouteObject[] = [
  {
    path: 'dashboard',
    element: <DashboardPage />
  }
]

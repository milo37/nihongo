import { lazy } from 'react'
import type { RouteObject } from 'react-router'
const AdminReportPage = lazy(() =>
  import('@app/admin-report/page').then((module) => ({
    default: module.AdminReportPage
  }))
)
const AdminReportDetailPage = lazy(() =>
  import('@app/admin-report/detail/page').then((module) => ({
    default: module.AdminReportDetailPage
  }))
)
export const adminReportRoutes: RouteObject[] = [
  { path: 'admin/reports', element: <AdminReportPage /> },
  { path: 'admin/reports/:reportId', element: <AdminReportDetailPage /> }
]

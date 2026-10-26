import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const AdminAuditLogPage = lazy(() =>
  import('@app/admin-audit/page').then((module) => ({
    default: module.AdminAuditLogPage
  }))
)

export const adminAuditRoutes: RouteObject[] = [
  { path: 'audit-log', element: <AdminAuditLogPage /> }
]

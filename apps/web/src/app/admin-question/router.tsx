import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const AdminQuestionPage = lazy(() =>
  import('@app/admin-question/page').then((module) => ({
    default: module.AdminQuestionPage
  }))
)
const CreateAdminQuestionPage = lazy(() =>
  import('@app/admin-question/create/page').then((module) => ({
    default: module.CreateAdminQuestionPage
  }))
)
const AdminQuestionDetailPage = lazy(() =>
  import('@app/admin-question/detail/page').then((module) => ({
    default: module.AdminQuestionDetailPage
  }))
)
const AdminQuestionImportPage = lazy(() =>
  import('@app/admin-import/page').then((module) => ({
    default: module.AdminQuestionImportPage
  }))
)
const AdminAuditLogPage = lazy(() =>
  import('@app/admin-audit/page').then((module) => ({
    default: module.AdminAuditLogPage
  }))
)
const AdminQuestionReportPage = lazy(() =>
  import('@app/admin-report/page').then((module) => ({
    default: module.AdminQuestionReportPage
  }))
)
const AdminQuestionReportDetailPage = lazy(() =>
  import('@app/admin-report/detail/page').then((module) => ({
    default: module.AdminQuestionReportDetailPage
  }))
)

export const adminQuestionRoutes: RouteObject[] = [
  { path: 'admin/questions', element: <AdminQuestionPage /> },
  { path: 'admin/questions/new', element: <CreateAdminQuestionPage /> },
  { path: 'admin/questions/import', element: <AdminQuestionImportPage /> },
  {
    path: 'admin/questions/:questionId',
    element: <AdminQuestionDetailPage />
  },
  {
    path: 'admin/questions/:questionId/edit',
    element: <AdminQuestionDetailPage />
  },
  { path: 'admin/audit-log', element: <AdminAuditLogPage /> },
  { path: 'admin/reports', element: <AdminQuestionReportPage /> },
  {
    path: 'admin/reports/:reportId',
    element: <AdminQuestionReportDetailPage />
  }
]

import { lazy } from 'react'
import type { RouteObject } from 'react-router'
import { adminReportRoutes } from '@app/admin-report/router'

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

export const adminQuestionRoutes: RouteObject[] = [
  ...adminReportRoutes,
  {
    path: 'admin/questions',
    element: <AdminQuestionPage />
  },
  {
    path: 'admin/questions/new',
    element: <CreateAdminQuestionPage />
  },
  {
    path: 'admin/questions/:questionId',
    element: <AdminQuestionDetailPage />
  },
  {
    path: 'admin/questions/:questionId/edit',
    element: <AdminQuestionDetailPage />
  }
]

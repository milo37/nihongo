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
const EditAdminQuestionPage = lazy(() =>
  import('@app/admin-question/edit/page').then((module) => ({
    default: module.EditAdminQuestionPage
  }))
)

export const adminQuestionRoutes: RouteObject[] = [
  {
    path: 'admin/questions',
    element: <AdminQuestionPage />
  },
  {
    path: 'admin/questions/new',
    element: <CreateAdminQuestionPage />
  },
  {
    path: 'admin/questions/:questionId/edit',
    element: <EditAdminQuestionPage />
  }
]

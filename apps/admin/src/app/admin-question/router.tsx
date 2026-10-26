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

export const adminQuestionRoutes: RouteObject[] = [
  {
    path: 'questions',
    element: <AdminQuestionPage />
  },
  {
    path: 'questions/new',
    element: <CreateAdminQuestionPage />
  },
  { path: 'questions/import', element: <AdminQuestionImportPage /> },
  { path: 'questions/:questionId', element: <AdminQuestionDetailPage /> },
  {
    path: 'questions/:questionId/edit',
    element: <EditAdminQuestionPage />
  }
]

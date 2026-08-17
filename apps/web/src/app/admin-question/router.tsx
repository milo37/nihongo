import { lazy } from 'react'
import type { RouteObject } from 'react-router'
import { UnsupportedFeaturePage } from '@app/unsupported/page'
import { isMockApiMode } from '@libs/apiMode'

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

const mockAdminQuestionRoutes: RouteObject[] = [
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

export const adminQuestionRoutes: RouteObject[] = isMockApiMode
  ? mockAdminQuestionRoutes
  : [
      {
        path: 'admin/questions/*',
        element: (
          <UnsupportedFeaturePage
            title="문제 관리는 아직 사용할 수 없습니다"
            description="관리자 CMS는 실제 API 이관 전이므로 조회·등록·수정 요청을 보내지 않습니다."
          />
        )
      }
    ]

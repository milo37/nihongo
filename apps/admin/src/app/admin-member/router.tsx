import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const AdminMembersPage = lazy(() =>
  import('@app/admin-member/page').then((module) => ({
    default: module.AdminMembersPage
  }))
)
const AdminMemberDetailPage = lazy(() =>
  import('@app/admin-member/detail/page').then((module) => ({
    default: module.AdminMemberDetailPage
  }))
)

export const adminMemberRoutes: RouteObject[] = [
  { path: 'members', element: <AdminMembersPage /> },
  { path: 'members/:memberId', element: <AdminMemberDetailPage /> }
]

import type { RouteObject } from 'react-router'
export const adminReportRoutes: RouteObject[] = [
  {
    path: 'reports',
    lazy: async () => ({
      Component: (await import('@app/admin-report/page')).AdminReportsPage
    })
  },
  {
    path: 'reports/:reportId',
    lazy: async () => ({
      Component: (await import('@app/admin-report/detail/page'))
        .AdminReportDetailPage
    })
  }
]

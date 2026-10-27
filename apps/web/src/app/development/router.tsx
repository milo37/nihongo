import type { RouteObject } from 'react-router'

export const developmentRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/dev/connection',
        lazy: async () => ({
          Component: (await import('@app/development/page')).ConnectionPage
        })
      }
    ]
  : []

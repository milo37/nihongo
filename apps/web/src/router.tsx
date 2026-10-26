import { createBrowserRouter } from 'react-router'
import type { RouteObject } from 'react-router'
import { bookmarkRoutes } from '@app/bookmark/router'
import { dashboardRoutes } from '@app/dashboard/router'
import { ForbiddenPage } from '@nihongo/browser/app/forbidden/page'
import { homeRoutes } from '@app/home/router'
import { Layout } from '@app/layout'
import { loginRoutes } from '@app/login/router'
import { NotFoundPage } from '@nihongo/browser/app/not-found/page'
import { RouteErrorPage } from '@nihongo/browser/app/not-found/route-error'
import { practiceRoutes } from '@app/practice/router'
import { wrongNoteRoutes } from '@app/wrong-note/router'
import { AuthErrorHandlerProvider } from '@nihongo/browser/provider/AuthErrorHandlerProvider'
import {
  ProtectedRouteProvider,
  RequireRole
} from '@nihongo/browser/provider/ProtectedRouteProvider'

const developmentRoutes: RouteObject[] = import.meta.env.DEV
  ? (await import('@app/development/router')).developmentRoutes
  : []

export const appRoutes: RouteObject[] = [
  ...developmentRoutes,
  {
    path: '/',
    element: (
      <ProtectedRouteProvider
        renderAuthError={(content) => <Layout>{content}</Layout>}
      >
        <AuthErrorHandlerProvider />
        <Layout />
      </ProtectedRouteProvider>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      ...homeRoutes,
      ...loginRoutes,
      ...practiceRoutes,
      ...wrongNoteRoutes.filter((route) => route.path === 'wrong-notes'),
      {
        element: <RequireRole allowedRoles={['USER', 'ADMIN']} />,
        children: [
          ...dashboardRoutes,
          ...wrongNoteRoutes.filter((route) => route.path !== 'wrong-notes'),
          ...bookmarkRoutes
        ]
      },
      {
        path: 'forbidden',
        element: <ForbiddenPage />
      },
      {
        path: '*',
        element: <NotFoundPage />
      }
    ]
  }
]

export const router = createBrowserRouter(appRoutes)

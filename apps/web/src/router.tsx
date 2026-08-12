import { createBrowserRouter } from 'react-router'
import type { RouteObject } from 'react-router'
import { adminQuestionRoutes } from '@app/admin-question/router'
import { bookmarkRoutes } from '@app/bookmark/router'
import { dashboardRoutes } from '@app/dashboard/router'
import { ForbiddenPage } from '@app/forbidden/page'
import { homeRoutes } from '@app/home/router'
import { Layout } from '@app/layout'
import { loginRoutes } from '@app/login/router'
import { NotFoundPage } from '@app/not-found/page'
import { RouteErrorPage } from '@app/not-found/route-error'
import { practiceRoutes } from '@app/practice/router'
import { wrongNoteRoutes } from '@app/wrong-note/router'
import { AuthErrorHandlerProvider } from '@provider/AuthErrorHandlerProvider'
import {
  ProtectedRouteProvider,
  RequireRole
} from '@provider/ProtectedRouteProvider'

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: (
      <ProtectedRouteProvider>
        <AuthErrorHandlerProvider />
        <Layout />
      </ProtectedRouteProvider>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      ...homeRoutes,
      ...loginRoutes,
      ...practiceRoutes,
      {
        element: <RequireRole allowedRoles={['USER', 'ADMIN']} />,
        children: [...dashboardRoutes, ...wrongNoteRoutes, ...bookmarkRoutes]
      },
      {
        element: <RequireRole allowedRoles={['ADMIN']} />,
        children: adminQuestionRoutes
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

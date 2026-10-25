import { createBrowserRouter, Navigate } from 'react-router'
import type { RouteObject } from 'react-router'
import { AppLayout } from '@nihongo/browser/common/components/AppLayout'
import { ForbiddenPage } from '@nihongo/browser/app/forbidden/page'
import { NotFoundPage } from '@nihongo/browser/app/not-found/page'
import { RouteErrorPage } from '@nihongo/browser/app/not-found/route-error'
import {
  ProtectedRouteProvider,
  RequireRole
} from '@nihongo/browser/provider/ProtectedRouteProvider'
import { AuthErrorHandlerProvider } from '@nihongo/browser/provider/AuthErrorHandlerProvider'
import { adminQuestionRoutes } from '@app/admin-question/router'

export const adminRoutes: RouteObject[] = [
  {
    path: '/',
    element: (
      <ProtectedRouteProvider
        renderAuthError={(content) => (
          <AppLayout robots="noindex,follow" reviewReturnContext={null}>
            {content}
          </AppLayout>
        )}
      >
        <AuthErrorHandlerProvider />
        <AppLayout robots="noindex,follow" reviewReturnContext={null} />
      </ProtectedRouteProvider>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <RequireRole allowedRoles={['ADMIN']} />,
        children: [
          { index: true, element: <Navigate replace to="questions" /> },
          ...adminQuestionRoutes
        ]
      },
      { path: 'forbidden', element: <ForbiddenPage /> },
      { path: '*', element: <NotFoundPage /> }
    ]
  }
]

export const createAdminRouter = () =>
  createBrowserRouter(adminRoutes, { basename: '/admin' })

import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router'
import type { RouteObject } from 'react-router'
import { bookmarkRoutes } from '@app/bookmark/router'
import { accountRoutes } from '@app/account/router'
import { dashboardRoutes, homeRoutes } from '@app/dashboard/router'
import { ForbiddenPage } from '@nihongo/browser/app/forbidden/page'
import { Layout } from '@app/layout'
import { AccountRestoreNotice } from '@app/login/components/AccountRestoreNotice'
import { GuestResultCarry } from '@app/login/components/GuestResultCarry'
import { OnboardingCheck } from '@app/login/components/OnboardingCheck'
import { AppErrorReportButton } from '@app/question-report/components/AppErrorReportDialog'
import { loginRoutes } from '@app/login/router'
import { NotFoundPage } from '@nihongo/browser/app/not-found/page'
import { RouteErrorPage } from '@nihongo/browser/app/not-found/route-error'
import { operationsRoutes } from '@app/operations/router'
import { practiceRoutes } from '@app/practice/router'
import { wrongNoteRoutes } from '@app/wrong-note/router'
import { AuthErrorHandlerProvider } from '@nihongo/browser/provider/AuthErrorHandlerProvider'
import {
  ProtectedRouteProvider,
  RequireRole
} from '@nihongo/browser/provider/ProtectedRouteProvider'

// Loaded only when a guest opens a member-only screen.
const GuestGate = lazy(async () => ({
  default: (await import('@app/login/components/GuestGate')).GuestGate
}))

const developmentRoutes: RouteObject[] = import.meta.env.DEV
  ? (await import('@app/development/router')).developmentRoutes
  : []

// #1268: /ja, /ja/practice, /ja/legal and /ja/support open the same screens
// as /, /practice, /legal and /support (the first visit shows Japanese). Links
// inside the screens keep their usual addresses.
const publicRoutes: RouteObject[] = [
  ...homeRoutes,
  ...practiceRoutes.filter((route) => route.path === 'practice'),
  ...operationsRoutes
]
const japanesePublicRoutes: RouteObject[] = publicRoutes.map((route) => ({
  path: route.index ? 'ja' : `ja/${route.path ?? ''}`,
  element: route.element
}))

export const appRoutes: RouteObject[] = [
  ...developmentRoutes,
  {
    path: '/',
    element: (
      <ProtectedRouteProvider
        renderAuthError={(content) => <Layout>{content}</Layout>}
      >
        <AuthErrorHandlerProvider />
        <GuestResultCarry />
        <OnboardingCheck />
        <AccountRestoreNotice />
        <Layout />
      </ProtectedRouteProvider>
    ),
    errorElement: <RouteErrorPage action={<AppErrorReportButton />} />,
    children: [
      ...homeRoutes,
      ...accountRoutes,
      ...loginRoutes,
      ...operationsRoutes,
      ...practiceRoutes,
      ...japanesePublicRoutes,
      ...wrongNoteRoutes.filter((route) => route.path === 'wrong-notes'),
      {
        element: (
          <RequireRole
            allowedRoles={['USER', 'ADMIN']}
            guestElement={
              <Suspense fallback={null}>
                <GuestGate />
              </Suspense>
            }
          />
        ),
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

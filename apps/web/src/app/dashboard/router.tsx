import { lazy } from 'react'
import type { ReactElement } from 'react'
import type { RouteObject } from 'react-router'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

const DashboardPage = lazy(() =>
  import('@app/dashboard/page').then((module) => ({
    default: module.DashboardPage
  }))
)
const HomePage = lazy(() =>
  import('@app/home/page').then((module) => ({ default: module.HomePage }))
)
const MemberHome = lazy(() =>
  import('@app/dashboard/page').then((module) => ({
    default: module.MemberHome
  }))
)

// #978: guests and members share one home address, /. The choice sits here,
// outside the public home chunk, so guests never load the member lines.
const Home = (): ReactElement => {
  const { isReady, role } = useAuth()
  return isReady && role !== 'GUEST' ? <MemberHome /> : <HomePage />
}

export const homeRoutes: RouteObject[] = [
  {
    index: true,
    element: <Home />
  }
]

export const dashboardRoutes: RouteObject[] = [
  {
    path: 'dashboard',
    element: <DashboardPage />
  }
]

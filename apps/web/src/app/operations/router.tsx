import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const OperationsInformationPage = lazy(() =>
  import('@app/operations/page').then((module) => ({
    default: module.OperationsInformationPage
  }))
)

export const operationsRoutes: RouteObject[] = [
  {
    path: 'legal',
    element: <OperationsInformationPage page="legal" />
  },
  {
    path: 'account/data',
    element: <OperationsInformationPage page="account" />
  },
  {
    path: 'support',
    element: <OperationsInformationPage page="support" />
  }
]

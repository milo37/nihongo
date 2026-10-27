import { lazy } from 'react'
import type { RouteObject } from 'react-router'
import {
  operationsPageKinds,
  operationsPages
} from '@app/operations/operationsContent'

const OperationsInformationPage = lazy(() =>
  import('@app/operations/page').then((module) => ({
    default: module.OperationsInformationPage
  }))
)

export const operationsRoutes: RouteObject[] = operationsPageKinds.map(
  (page) => ({
    path: operationsPages[page].path.slice(1),
    element: <OperationsInformationPage page={page} />
  })
)

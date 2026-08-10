import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const HomePage = lazy(() =>
  import('@app/home/page').then((module) => ({ default: module.HomePage }))
)

export const homeRoutes: RouteObject[] = [
  {
    index: true,
    element: <HomePage />
  }
]

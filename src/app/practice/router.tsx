import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const PracticePage = lazy(() =>
  import('@app/practice/page').then((module) => ({
    default: module.PracticePage
  }))
)
const PracticeSessionPage = lazy(() =>
  import('@app/practice/session/page').then((module) => ({
    default: module.PracticeSessionPage
  }))
)
const PracticeResultPage = lazy(() =>
  import('@app/practice/result/page').then((module) => ({
    default: module.PracticeResultPage
  }))
)

export const practiceRoutes: RouteObject[] = [
  {
    path: 'practice',
    element: <PracticePage />
  },
  {
    path: 'practice/session/:sessionId',
    element: <PracticeSessionPage />
  },
  {
    path: 'practice/result/:sessionId',
    element: <PracticeResultPage />
  }
]

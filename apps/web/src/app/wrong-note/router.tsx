import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const WrongNotePage = lazy(() =>
  import('@app/wrong-note/page').then((module) => ({
    default: module.WrongNotePage
  }))
)
const WrongNoteDetailPage = lazy(() =>
  import('@app/wrong-note/detail/page').then((module) => ({
    default: module.WrongNoteDetailPage
  }))
)

export const wrongNoteRoutes: RouteObject[] = [
  {
    path: 'wrong-notes',
    element: <WrongNotePage />
  },
  {
    path: 'wrong-notes/:questionId',
    element: <WrongNoteDetailPage />
  }
]

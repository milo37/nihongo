import { lazy } from 'react'
import type { RouteObject } from 'react-router'

const WrongNoteReviewCenterPage = lazy(() =>
  import('@app/wrong-note/center/page').then((module) => ({
    default: module.WrongNoteReviewCenterPage
  }))
)
const WrongNoteHistoryPage = lazy(() =>
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
    element: <WrongNoteReviewCenterPage />
  },
  {
    path: 'wrong-notes/history',
    element: <WrongNoteHistoryPage />
  },
  {
    path: 'wrong-notes/:questionId',
    element: <WrongNoteDetailPage />
  }
]

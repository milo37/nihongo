import { lazy } from 'react'
import { toReviewListSearch } from '@app/wrong-note/wrongNoteReturnTo'
import { Navigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type { RouteObject } from 'react-router'

const WrongNoteReviewCenterPage = lazy(() =>
  import('@app/wrong-note/center/page').then((module) => ({
    default: module.WrongNoteReviewCenterPage
  }))
)
const LegacyReviewHistoryRedirect = (): ReactElement => {
  const [search] = useSearchParams()
  const query = toReviewListSearch(search)
  return <Navigate replace to={`/wrong-notes${query ? `?${query}` : ''}`} />
}
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
    element: <LegacyReviewHistoryRedirect />
  },
  {
    path: 'wrong-notes/:questionId',
    element: <WrongNoteDetailPage />
  }
]

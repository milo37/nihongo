import { lazy } from 'react'
import { parseReviewQueueSearch } from '@app/wrong-note/reviewQueueSearch'
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
  const mapped = new URLSearchParams(search)
  if (mapped.get('status') === 'SOLVED') mapped.set('view', 'SOLVED')
  else if (mapped.get('status') === 'NEW') mapped.set('view', 'UNREVIEWED')
  else if (mapped.get('status') === 'AGAIN') mapped.set('view', 'REPEATED')
  mapped.delete('status')
  return (
    <Navigate
      replace
      to={`/wrong-notes?${parseReviewQueueSearch(mapped).canonicalSearch}`}
    />
  )
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

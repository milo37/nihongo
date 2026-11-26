import { useQuery } from '@tanstack/react-query'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import {
  getReviewSetReturnPath,
  getSetReturnPath
} from '@app/practice/setReturnPath'
import type { SetReturnPath } from '@app/practice/setReturnPath'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

/**
 * Where a finished set's button goes (JLP-856). #1283: a review set asks
 * what waits for review now, every level, as the list's default tab counts
 * it (this set's wrong answers are in it). While loading or on failure the
 * button keeps the wrong-note list.
 */
export const useSetReturnPath = (
  mode: StudySessionView['session']['mode'],
  isGuest: boolean
): SetReturnPath | null => {
  const listPath = isGuest ? null : getSetReturnPath(mode)
  const toReview = useQuery({
    ...wrongNoteQueries.reviewList({ state: 'TO_REVIEW', pageSize: 1 }),
    enabled: listPath === '/wrong-notes'
  })
  return getReviewSetReturnPath(
    listPath,
    !toReview.isFetching && toReview.data?.total === 0
  )
}

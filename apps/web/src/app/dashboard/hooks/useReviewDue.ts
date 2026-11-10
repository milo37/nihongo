import { useQuery } from '@tanstack/react-query'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

/**
 * Wrong answers waiting for review (members, first screen) and the level and
 * subject the wrong-note [복습 시작] would start from.
 */
export const useReviewDue = () => {
  const list = useQuery(
    wrongNoteQueries.reviewList({ state: 'TO_REVIEW', pageSize: 1 })
  )
  return {
    count: list.data?.counts.toReview ?? 0,
    oldestToReview: list.data?.oldestToReview ?? null,
    refetch: list.refetch
  }
}

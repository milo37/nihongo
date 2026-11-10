import { useQuery } from '@tanstack/react-query'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

/** How many wrong answers wait for review (members, first screen). */
export const useReviewDueCount = (): number => {
  const list = useQuery(
    wrongNoteQueries.reviewList({ state: 'TO_REVIEW', pageSize: 1 })
  )
  return list.data?.counts.toReview ?? 0
}

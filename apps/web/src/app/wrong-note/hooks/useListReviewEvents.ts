import { useInfiniteQuery } from '@tanstack/react-query'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

export const useListReviewEvents = (questionId: string, pageSize = 20) => {
  return useInfiniteQuery(wrongNoteQueries.reviewEvents(questionId, pageSize))
}

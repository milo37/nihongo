import { useQuery } from '@tanstack/react-query'
import type { ListReviewQueueRequest } from '@api/wrong-note/listReviewQueue/schema'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

export const useListReviewQueue = (input: ListReviewQueueRequest) => {
  return useQuery(wrongNoteQueries.reviewQueue(input))
}

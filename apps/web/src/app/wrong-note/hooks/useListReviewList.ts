import { useQuery } from '@tanstack/react-query'
import type { ListReviewListRequest } from '@api/wrong-note/listReviewList/schema'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

export const useListReviewList = (input: ListReviewListRequest) => {
  return useQuery({
    ...wrongNoteQueries.reviewList(input),
    refetchOnMount: 'always'
  })
}

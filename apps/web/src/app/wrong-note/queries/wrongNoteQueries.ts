import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions
} from '@tanstack/react-query'
import { listReviewListQuerySchema } from '@nihongo/contracts/wrong-note/list-review-list'
import { getWrongNoteV1 } from '@api/wrong-note/getWrongNoteV1'
import { listReviewEvents } from '@api/wrong-note/listReviewEvents'
import { listReviewList } from '@api/wrong-note/listReviewList'
import type { ListReviewListRequest } from '@api/wrong-note/listReviewList/schema'
import { toCanonicalWrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import { serverStateQueryKeys } from '@nihongo/browser/libs/serverStateQueryKeys'

const getWrongNoteDetail = async (questionId: string) => {
  return toCanonicalWrongNoteDetailView(await getWrongNoteV1(questionId))
}

export const wrongNoteQueries = {
  allKey: serverStateQueryKeys.wrongNote.all,
  detail: (questionId: string) =>
    queryOptions({
      queryKey: serverStateQueryKeys.wrongNote.detail(questionId),
      queryFn: () => getWrongNoteDetail(questionId),
      enabled: questionId.length > 0
    }),
  reviewList: (input: ListReviewListRequest) => {
    const query = listReviewListQuerySchema.parse(input)
    return queryOptions({
      queryKey: [
        ...serverStateQueryKeys.wrongNote.all(),
        'review-list',
        query
      ] as const,
      queryFn: () => listReviewList(query),
      placeholderData: keepPreviousData,
      staleTime: 15_000
    })
  },
  reviewEvents: (questionId: string, pageSize = 20) =>
    infiniteQueryOptions({
      queryKey: serverStateQueryKeys.wrongNote.reviewEventConnection(
        questionId,
        pageSize
      ),
      queryFn: ({ pageParam }) =>
        listReviewEvents(questionId, {
          pageSize,
          ...(pageParam === null ? {} : { cursor: pageParam })
        }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      enabled: questionId.length > 0,
      staleTime: 15_000
    })
} as const

import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions
} from '@tanstack/react-query'
import { listReviewQueueQuerySchema } from '@nihongo/contracts/wrong-note/list-review-queue'
import { getWrongNoteV1 } from '@api/wrong-note/getWrongNoteV1'
import { getWrongNoteMemo } from '@api/wrong-note/getWrongNoteMemo'
import { listReviewEvents } from '@api/wrong-note/listReviewEvents'
import { listReviewQueue } from '@api/wrong-note/listReviewQueue'
import type { ListWrongNoteRequest } from '@api/wrong-note/listWrongNote/schema'
import { listWrongNotesV1 } from '@api/wrong-note/listWrongNotesV1'
import type { ListReviewQueueRequest } from '@api/wrong-note/listReviewQueue/schema'
import {
  toCanonicalWrongNoteDetailView,
  toCanonicalWrongNoteListView
} from '@app/wrong-note/adapters/wrongNoteView'
import { serverStateQueryKeys } from '@libs/serverStateQueryKeys'

const listWrongNotes = async (params: ListWrongNoteRequest) => {
  return toCanonicalWrongNoteListView(await listWrongNotesV1(params))
}

const getWrongNoteDetail = async (questionId: string) => {
  return toCanonicalWrongNoteDetailView(await getWrongNoteV1(questionId))
}

export const wrongNoteQueries = {
  allKey: serverStateQueryKeys.wrongNote.all,
  historicalListsKey: serverStateQueryKeys.wrongNote.historicalLists,
  historicalList: (params: ListWrongNoteRequest) =>
    queryOptions({
      queryKey: [
        ...serverStateQueryKeys.wrongNote.historicalLists(),
        params
      ] as const,
      queryFn: () => listWrongNotes(params),
      placeholderData: keepPreviousData,
      staleTime: 15_000
    }),
  list: (params: ListWrongNoteRequest) =>
    wrongNoteQueries.historicalList(params),
  detail: (questionId: string) =>
    queryOptions({
      queryKey: serverStateQueryKeys.wrongNote.detail(questionId),
      queryFn: () => getWrongNoteDetail(questionId),
      enabled: questionId.length > 0
    }),
  reviewQueue: (input: ListReviewQueueRequest) => {
    const query = listReviewQueueQuerySchema.parse(input)
    return queryOptions({
      queryKey: [
        ...serverStateQueryKeys.wrongNote.reviewQueues(),
        query
      ] as const,
      queryFn: () => listReviewQueue(query),
      placeholderData: keepPreviousData,
      staleTime: 15_000
    })
  },
  memo: (questionId: string) =>
    queryOptions({
      queryKey: serverStateQueryKeys.wrongNote.memo(questionId),
      queryFn: () => getWrongNoteMemo(questionId),
      enabled: questionId.length > 0,
      staleTime: 15_000
    }),
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

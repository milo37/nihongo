import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { getWrongNote } from '@api/wrong-note/getWrongNote'
import { listWrongNote } from '@api/wrong-note/listWrongNote'
import type { ListWrongNoteRequest } from '@api/wrong-note/listWrongNote/schema'
import { reviewWrongNote } from '@api/wrong-note/reviewWrongNote'
import type { ReviewWrongNoteRequest } from '@api/wrong-note/reviewWrongNote/schema'
import { updateWrongNoteMemo } from '@api/wrong-note/updateWrongNoteMemo'
import type { UpdateWrongNoteMemoRequest } from '@api/wrong-note/updateWrongNoteMemo/schema'

export const wrongNoteQueries = {
  allKey: () => ['wrong-note'] as const,
  list: (params: ListWrongNoteRequest) =>
    queryOptions({
      queryKey: [
        ...wrongNoteQueries.allKey(),
        'list-wrong-notes',
        params
      ] as const,
      queryFn: () => listWrongNote(params),
      staleTime: 15_000
    }),
  detail: (questionId: string) =>
    queryOptions({
      queryKey: [
        ...wrongNoteQueries.allKey(),
        'get-wrong-note',
        questionId
      ] as const,
      queryFn: () => getWrongNote(questionId),
      enabled: questionId.length > 0
    })
} as const

export const wrongNoteMutations = {
  updateMemo: (questionId: string) =>
    mutationOptions({
      mutationKey: [
        ...wrongNoteQueries.allKey(),
        'update-wrong-note-memo',
        questionId
      ] as const,
      mutationFn: (input: UpdateWrongNoteMemoRequest) =>
        updateWrongNoteMemo(questionId, input)
    }),
  review: (questionId: string) =>
    mutationOptions({
      mutationKey: [
        ...wrongNoteQueries.allKey(),
        'review-wrong-note',
        questionId
      ] as const,
      mutationFn: (input: ReviewWrongNoteRequest) =>
        reviewWrongNote(questionId, input)
    })
} as const

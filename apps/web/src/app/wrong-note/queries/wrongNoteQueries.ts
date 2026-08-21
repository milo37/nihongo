import { queryOptions } from '@tanstack/react-query'
import { getWrongNoteV1 } from '@api/wrong-note/getWrongNoteV1'
import type { ListWrongNoteRequest } from '@api/wrong-note/listWrongNote/schema'
import { listWrongNotesV1 } from '@api/wrong-note/listWrongNotesV1'
import {
  toCanonicalWrongNoteDetailView,
  toCanonicalWrongNoteListView
} from '@app/wrong-note/adapters/wrongNoteView'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'

const listWrongNotes = async (params: ListWrongNoteRequest) => {
  return toCanonicalWrongNoteListView(await listWrongNotesV1(params))
}

const getWrongNoteDetail = async (questionId: string) => {
  return toCanonicalWrongNoteDetailView(await getWrongNoteV1(questionId))
}

export const wrongNoteQueries = {
  allKey: serverStateQueryKeys.wrongNote.all,
  list: (params: ListWrongNoteRequest) =>
    queryOptions({
      queryKey: [
        ...wrongNoteQueries.allKey(),
        'list-wrong-notes',
        params
      ] as const,
      queryFn: () => listWrongNotes(params),
      staleTime: 15_000
    }),
  detail: (questionId: string) =>
    queryOptions({
      queryKey: [
        ...wrongNoteQueries.allKey(),
        'get-wrong-note',
        questionId
      ] as const,
      queryFn: () => getWrongNoteDetail(questionId),
      enabled: questionId.length > 0
    })
} as const

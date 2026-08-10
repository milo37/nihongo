import { useQuery } from '@tanstack/react-query'
import type { ListWrongNoteRequest } from '@api/wrong-note/listWrongNote/schema'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

export const useListWrongNotes = (params: ListWrongNoteRequest) => {
  return useQuery(wrongNoteQueries.list(params))
}

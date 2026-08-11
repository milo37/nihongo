import { safeGet } from '@api/http'
import {
  listWrongNoteRequestSchema,
  listWrongNoteResponseSchema
} from '@api/wrong-note/listWrongNote/schema'
import type {
  ListWrongNoteRequest,
  ListWrongNoteResponse
} from '@api/wrong-note/listWrongNote/schema'

const requestWrongNoteList = safeGet(listWrongNoteResponseSchema)

export const listWrongNote = (
  params: ListWrongNoteRequest = {}
): Promise<ListWrongNoteResponse> =>
  requestWrongNoteList('/wrong-note', listWrongNoteRequestSchema.parse(params))

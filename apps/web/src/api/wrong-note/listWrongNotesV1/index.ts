import { safeGet } from '@api/http'
import {
  listWrongNotesV1RequestSchema,
  listWrongNotesV1ResponseSchema
} from '@api/wrong-note/listWrongNotesV1/schema'
import type {
  ListWrongNotesV1Request,
  ListWrongNotesV1Response
} from '@api/wrong-note/listWrongNotesV1/schema'

const requestWrongNoteList = safeGet(listWrongNotesV1ResponseSchema)

export const listWrongNotesV1 = (
  params: ListWrongNotesV1Request = {}
): Promise<ListWrongNotesV1Response> =>
  requestWrongNoteList(
    '/v1/wrong-notes',
    listWrongNotesV1RequestSchema.parse(params)
  )

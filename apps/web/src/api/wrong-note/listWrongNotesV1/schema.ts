import {
  listWrongNotesQuerySchema as canonicalListWrongNotesQuerySchema,
  listWrongNotesResponseSchema as canonicalListWrongNotesResponseSchema
} from '@nihongo/contracts/wrong-note/list-wrong-notes'
import type {
  ListWrongNotesQuery,
  ListWrongNotesResponse,
  ParsedListWrongNotesQuery
} from '@nihongo/contracts/wrong-note/list-wrong-notes'

export const listWrongNotesV1RequestSchema = canonicalListWrongNotesQuerySchema
export const listWrongNotesV1ResponseSchema =
  canonicalListWrongNotesResponseSchema

export type ListWrongNotesV1Request = ListWrongNotesQuery
export type ListWrongNotesV1Params = ParsedListWrongNotesQuery
export type ListWrongNotesV1Response = ListWrongNotesResponse

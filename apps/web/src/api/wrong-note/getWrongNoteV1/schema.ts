import {
  getWrongNoteParamsSchema as canonicalGetWrongNoteParamsSchema,
  getWrongNoteResponseSchema as canonicalGetWrongNoteResponseSchema
} from '@nihongo/contracts/wrong-note/get-wrong-note'
import type {
  GetWrongNoteParams,
  GetWrongNoteResponse
} from '@nihongo/contracts/wrong-note/get-wrong-note'

export const getWrongNoteV1RequestSchema = canonicalGetWrongNoteParamsSchema
export const getWrongNoteV1ResponseSchema = canonicalGetWrongNoteResponseSchema

export type GetWrongNoteV1Request = GetWrongNoteParams
export type GetWrongNoteV1Response = GetWrongNoteResponse

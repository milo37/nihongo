import {
  createUpdateWrongNoteMemoResponseSchema,
  updateWrongNoteMemoBodySchema,
  updateWrongNoteMemoParamsSchema,
  updateWrongNoteMemoResponseSchema
} from '@nihongo/contracts/wrong-note/update-wrong-note-memo'
export type { ParsedUpdateWrongNoteMemoBody } from '@nihongo/contracts/wrong-note/update-wrong-note-memo'

export const updateWrongNoteMemoRequestParamsSchema =
  updateWrongNoteMemoParamsSchema
export const updateWrongNoteMemoRequestBodySchema =
  updateWrongNoteMemoBodySchema
export const updateWrongNoteMemoResultSchema = updateWrongNoteMemoResponseSchema
export { createUpdateWrongNoteMemoResponseSchema }

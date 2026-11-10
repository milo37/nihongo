import {
  importGuestResultBodySchema as contractBodySchema,
  importGuestResultResponseSchema as contractResponseSchema
} from '@nihongo/contracts/study/import-guest-result'
import type { ImportGuestResultResponse } from '@nihongo/contracts/study/import-guest-result'

export const importGuestResultBodySchema = contractBodySchema
export const importGuestResultResponseSchema = contractResponseSchema

export type { ImportGuestResultResponse }

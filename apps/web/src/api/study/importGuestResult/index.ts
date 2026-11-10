import { safePost } from '@nihongo/browser/api/http'
import {
  importGuestResultBodySchema,
  importGuestResultResponseSchema
} from '@api/study/importGuestResult/schema'
import type { ImportGuestResultResponse } from '@api/study/importGuestResult/schema'

const request = safePost(importGuestResultResponseSchema)

export const importGuestResult = (): Promise<ImportGuestResultResponse> =>
  request('/v1/me/guest-result-import', importGuestResultBodySchema.parse({}))

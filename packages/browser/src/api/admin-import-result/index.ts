import { getAdminImportResultResponseSchema } from '@nihongo/contracts/admin/content-operations'
import { safeGet } from '../http'

const requestImportResult = safeGet(getAdminImportResultResponseSchema)

/** Recovers the stored apply response when the original response was lost. */
export const getAdminImportResult = (importId: string) =>
  requestImportResult(
    `/v1/admin/question-imports/${encodeURIComponent(importId)}`
  )

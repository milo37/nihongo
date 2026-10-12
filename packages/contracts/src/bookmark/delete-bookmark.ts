import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'

export const deleteBookmarkOperationId = 'bookmark.deleteBookmark' as const

export const deleteBookmarkParamsSchema = z
  .object({ questionId: opaqueIdSchema })
  .strict()

export const deleteBookmarkErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'INVALID_ID',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const deleteBookmarkErrorSchema = createApiFailureSchema(
  deleteBookmarkErrorCodeSchema
)

export type DeleteBookmarkParams = z.input<typeof deleteBookmarkParamsSchema>
export type DeleteBookmarkError = z.output<typeof deleteBookmarkErrorSchema>

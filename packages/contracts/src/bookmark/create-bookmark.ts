import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { bookmarkSummarySchema } from './bookmark.js'

export const createBookmarkOperationId = 'bookmark.createBookmark' as const

export const createBookmarkParamsSchema = z
  .object({ questionId: opaqueIdSchema })
  .strict()

export const createBookmarkBodySchema = z.object({}).strict()

export const createBookmarkResponseSchema = bookmarkSummarySchema

export const createBookmarkErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'INVALID_ID',
  'RESOURCE_NOT_FOUND',
  'QUESTION_NOT_AVAILABLE',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const createBookmarkErrorSchema = createApiFailureSchema(
  createBookmarkErrorCodeSchema
)

export type CreateBookmarkParams = z.input<typeof createBookmarkParamsSchema>
export type CreateBookmarkBody = z.input<typeof createBookmarkBodySchema>
export type CreateBookmarkResponse = z.output<
  typeof createBookmarkResponseSchema
>
export type CreateBookmarkError = z.output<typeof createBookmarkErrorSchema>

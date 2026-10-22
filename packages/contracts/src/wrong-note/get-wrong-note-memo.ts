import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { createUserMemoForQuestionSchema, userMemoSchema } from './user-memo.js'

export const getWrongNoteMemoOperationId = 'wrongNote.getWrongNoteMemo' as const

export const getWrongNoteMemoParamsSchema = z
  .object({ questionId: opaqueIdSchema })
  .strict()

export const getWrongNoteMemoQuerySchema = z.object({}).strict()

export const getWrongNoteMemoResponseSchema = userMemoSchema.nullable()

export const createGetWrongNoteMemoResponseSchema = (questionId: string) =>
  createUserMemoForQuestionSchema(questionId)

export const getWrongNoteMemoErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'INVALID_ID',
  'RESOURCE_NOT_FOUND',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const getWrongNoteMemoErrorSchema = createApiFailureSchema(
  getWrongNoteMemoErrorCodeSchema
)

export type GetWrongNoteMemoParams = z.input<
  typeof getWrongNoteMemoParamsSchema
>
export type GetWrongNoteMemoQuery = z.input<typeof getWrongNoteMemoQuerySchema>
export type GetWrongNoteMemoResponse = z.output<
  typeof getWrongNoteMemoResponseSchema
>
export type GetWrongNoteMemoError = z.output<typeof getWrongNoteMemoErrorSchema>

import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  createUserMemoForQuestionSchema,
  userMemoInputSchema,
  userMemoSchema
} from './user-memo.js'

export const updateWrongNoteMemoOperationId =
  'wrongNote.updateWrongNoteMemo' as const

export const updateWrongNoteMemoParamsSchema = z
  .object({ questionId: opaqueIdSchema })
  .strict()

export const updateWrongNoteMemoBodySchema = z
  .object({ memo: z.union([z.null(), userMemoInputSchema]) })
  .strict()

export const updateWrongNoteMemoResponseSchema = userMemoSchema.nullable()

export const createUpdateWrongNoteMemoResponseSchema = (questionId: string) =>
  createUserMemoForQuestionSchema(questionId)

export const updateWrongNoteMemoErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'INVALID_ID',
  'RESOURCE_NOT_FOUND',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const updateWrongNoteMemoErrorSchema = createApiFailureSchema(
  updateWrongNoteMemoErrorCodeSchema
)

export type UpdateWrongNoteMemoParams = z.input<
  typeof updateWrongNoteMemoParamsSchema
>
export type UpdateWrongNoteMemoBody = z.input<
  typeof updateWrongNoteMemoBodySchema
>
export type ParsedUpdateWrongNoteMemoBody = z.output<
  typeof updateWrongNoteMemoBodySchema
>
export type UpdateWrongNoteMemoResponse = z.output<
  typeof updateWrongNoteMemoResponseSchema
>
export type UpdateWrongNoteMemoError = z.output<
  typeof updateWrongNoteMemoErrorSchema
>

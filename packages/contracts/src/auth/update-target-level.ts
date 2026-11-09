import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { jlptLevelSchema } from '../common/enum.js'

export const updateTargetLevelOperationId = 'auth.updateTargetLevel' as const

/** JLP-815: the member's own target level; `/me` returns the same value. */
export const updateTargetLevelBodySchema = z
  .object({ targetLevel: jlptLevelSchema })
  .strict()

export const updateTargetLevelResponseSchema = z
  .object({ targetLevel: jlptLevelSchema })
  .strict()

export const updateTargetLevelErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const updateTargetLevelErrorSchema = createApiFailureSchema(
  updateTargetLevelErrorCodeSchema
)

export type UpdateTargetLevelBody = z.input<typeof updateTargetLevelBodySchema>
export type UpdateTargetLevelResponse = z.output<
  typeof updateTargetLevelResponseSchema
>
export type UpdateTargetLevelError = z.output<
  typeof updateTargetLevelErrorSchema
>

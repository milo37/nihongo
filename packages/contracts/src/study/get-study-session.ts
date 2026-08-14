import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { studySessionPayloadSchema } from './study-session.js'

export const getStudySessionOperationId = 'study.getStudySession' as const

export const getStudySessionParamsSchema = z
  .object({ sessionId: opaqueIdSchema })
  .strict()

export const getStudySessionResponseSchema = studySessionPayloadSchema

export const getStudySessionErrorCodeSchema = z.enum([
  'INVALID_ID',
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'GUEST_SESSION_EXPIRED',
  'RESOURCE_NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const getStudySessionErrorSchema = createApiFailureSchema(
  getStudySessionErrorCodeSchema
)

export type GetStudySessionParams = z.input<typeof getStudySessionParamsSchema>
export type GetStudySessionResponse = z.output<
  typeof getStudySessionResponseSchema
>
export type GetStudySessionError = z.output<typeof getStudySessionErrorSchema>

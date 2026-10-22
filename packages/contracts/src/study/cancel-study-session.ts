import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { practiceContractV2HeadersSchema } from './practice-contract.js'

export const cancelStudySessionOperationId = 'study.cancelStudySession' as const

export const cancelStudySessionParamsSchema = z
  .object({ sessionId: opaqueIdSchema })
  .strict()

export const cancelStudySessionHeadersSchema = practiceContractV2HeadersSchema

export const cancelStudySessionBodySchema = z.object({}).strict()

export const cancelStudySessionErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'GUEST_SESSION_EXPIRED',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'INVALID_ID',
  'RESOURCE_NOT_FOUND',
  'STUDY_SESSION_NOT_EDITABLE',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const cancelStudySessionErrorSchema = createApiFailureSchema(
  cancelStudySessionErrorCodeSchema
)

export type CancelStudySessionParams = z.input<
  typeof cancelStudySessionParamsSchema
>
export type CancelStudySessionHeaders = z.input<
  typeof cancelStudySessionHeadersSchema
>
export type CancelStudySessionBody = z.input<
  typeof cancelStudySessionBodySchema
>
export type CancelStudySessionError = z.output<
  typeof cancelStudySessionErrorSchema
>

import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  studySessionPayloadSchema,
  versionedStudySessionPayloadSchema
} from './study-session.js'
import { practiceContractV2HeadersSchema } from './practice-contract.js'

export const getStudySessionOperationId = 'study.getStudySession' as const

export const getStudySessionParamsSchema = z
  .object({ sessionId: opaqueIdSchema })
  .strict()

export const getStudySessionHeadersSchema = z.object({}).strict()

export const getStudySessionV2HeadersSchema = practiceContractV2HeadersSchema

export const getStudySessionResponseSchema = studySessionPayloadSchema

export const getStudySessionV2ResponseSchema =
  versionedStudySessionPayloadSchema

export const getStudySessionErrorCodeSchema = z.enum([
  'INVALID_ID',
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'GUEST_SESSION_EXPIRED',
  'RESOURCE_NOT_FOUND',
  'INVALID_REQUEST',
  'PRACTICE_CONTRACT_VERSION_MISMATCH',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const getStudySessionErrorSchema = createApiFailureSchema(
  getStudySessionErrorCodeSchema
)

export type GetStudySessionParams = z.input<typeof getStudySessionParamsSchema>
export type GetStudySessionHeaders = z.input<
  typeof getStudySessionHeadersSchema
>
export type GetStudySessionV2Headers = z.input<
  typeof getStudySessionV2HeadersSchema
>
export type GetStudySessionResponse = z.output<
  typeof getStudySessionResponseSchema
>
export type GetStudySessionError = z.output<typeof getStudySessionErrorSchema>
export type GetStudySessionV2Response = z.output<
  typeof getStudySessionV2ResponseSchema
>

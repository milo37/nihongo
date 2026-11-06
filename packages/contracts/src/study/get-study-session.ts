import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { versionedStudySessionPayloadSchema } from './study-session.js'
import { practiceContractV2HeadersSchema } from './practice-contract.js'

export const getStudySessionParamsSchema = z
  .object({ sessionId: opaqueIdSchema })
  .strict()

export const getStudySessionV2HeadersSchema = practiceContractV2HeadersSchema

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
export type GetStudySessionError = z.output<typeof getStudySessionErrorSchema>

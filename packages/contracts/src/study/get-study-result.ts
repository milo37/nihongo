import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { studyResultSchema } from './study-result.js'

export const getStudyResultOperationId = 'study.getStudyResult' as const

export const getStudyResultParamsSchema = z
  .object({ sessionId: opaqueIdSchema })
  .strict()

export const getStudyResultResponseSchema = studyResultSchema

export const getStudyResultErrorCodeSchema = z.enum([
  'INVALID_ID',
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'GUEST_SESSION_EXPIRED',
  'RESOURCE_NOT_FOUND',
  'STUDY_RESULT_NOT_READY',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const getStudyResultErrorSchema = createApiFailureSchema(
  getStudyResultErrorCodeSchema
)

export type GetStudyResultParams = z.input<typeof getStudyResultParamsSchema>
export type GetStudyResultResponse = z.output<
  typeof getStudyResultResponseSchema
>
export type GetStudyResultError = z.output<typeof getStudyResultErrorSchema>

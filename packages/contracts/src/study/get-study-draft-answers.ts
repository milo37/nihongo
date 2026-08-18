import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { practiceContractV2HeadersSchema } from './practice-contract.js'
import { studyDraftSnapshotSchema } from './study-draft.js'

export const getStudyDraftAnswersOperationId =
  'study.getStudyDraftAnswers' as const

export const getStudyDraftAnswersParamsSchema = z
  .object({ sessionId: opaqueIdSchema })
  .strict()

export const getStudyDraftAnswersHeadersSchema = practiceContractV2HeadersSchema

export const getStudyDraftAnswersResponseSchema = studyDraftSnapshotSchema

export const getStudyDraftAnswersErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'GUEST_SESSION_EXPIRED',
  'INVALID_REQUEST',
  'INVALID_ID',
  'RESOURCE_NOT_FOUND',
  'STUDY_SESSION_NOT_EDITABLE',
  'PRACTICE_CONTRACT_VERSION_MISMATCH',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const getStudyDraftAnswersErrorSchema = createApiFailureSchema(
  getStudyDraftAnswersErrorCodeSchema
)

export type GetStudyDraftAnswersParams = z.input<
  typeof getStudyDraftAnswersParamsSchema
>
export type GetStudyDraftAnswersHeaders = z.input<
  typeof getStudyDraftAnswersHeadersSchema
>
export type GetStudyDraftAnswersResponse = z.output<
  typeof getStudyDraftAnswersResponseSchema
>
export type GetStudyDraftAnswersError = z.output<
  typeof getStudyDraftAnswersErrorSchema
>

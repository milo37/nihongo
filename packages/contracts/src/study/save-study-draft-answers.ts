import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { idempotentPracticeContractV2HeadersSchema } from './practice-contract.js'
import {
  refineStudyDraftAnswers,
  studyDraftAnswerSchema,
  studyDraftSnapshotSchema
} from './study-draft.js'

export const saveStudyDraftAnswersOperationId =
  'study.saveStudyDraftAnswers' as const

export const saveStudyDraftAnswersParamsSchema = z
  .object({ sessionId: opaqueIdSchema })
  .strict()

export const saveStudyDraftAnswersHeadersSchema =
  idempotentPracticeContractV2HeadersSchema

export const saveStudyDraftAnswersBodySchema = z
  .object({
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    currentOrdinal: z.number().int().min(1).max(20),
    answers: z.array(studyDraftAnswerSchema).min(1).max(20)
  })
  .strict()
  .superRefine(refineStudyDraftAnswers)

export const saveStudyDraftAnswersResponseSchema = studyDraftSnapshotSchema

export const saveStudyDraftAnswersErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'GUEST_SESSION_EXPIRED',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'INVALID_ID',
  'RESOURCE_NOT_FOUND',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'DRAFT_VERSION_CONFLICT',
  'STUDY_SESSION_NOT_EDITABLE',
  'PRACTICE_CONTRACT_VERSION_MISMATCH',
  'VALIDATION_ERROR',
  'ANSWER_NOT_IN_SESSION',
  'OPTION_NOT_IN_VERSION',
  'INVALID_DURATION',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const saveStudyDraftAnswersErrorSchema = createApiFailureSchema(
  saveStudyDraftAnswersErrorCodeSchema
)

export type SaveStudyDraftAnswersParams = z.input<
  typeof saveStudyDraftAnswersParamsSchema
>
export type SaveStudyDraftAnswersHeaders = z.input<
  typeof saveStudyDraftAnswersHeadersSchema
>
export type SaveStudyDraftAnswersBody = z.input<
  typeof saveStudyDraftAnswersBodySchema
>
export type ParsedSaveStudyDraftAnswersBody = z.output<
  typeof saveStudyDraftAnswersBodySchema
>
export type SaveStudyDraftAnswersResponse = z.output<
  typeof saveStudyDraftAnswersResponseSchema
>
export type SaveStudyDraftAnswersError = z.output<
  typeof saveStudyDraftAnswersErrorSchema
>

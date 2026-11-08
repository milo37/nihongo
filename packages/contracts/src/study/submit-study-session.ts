import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { studyResultSchema } from './study-result.js'
import { idempotentPracticeContractV2HeadersSchema } from './practice-contract.js'

export const duplicateAnswerValidationMarker = 'DUPLICATE_ANSWER' as const

export const submitStudySessionParamsSchema = z
  .object({ sessionId: opaqueIdSchema })
  .strict()

export const submitStudySessionV2HeadersSchema =
  idempotentPracticeContractV2HeadersSchema

const submitStudySessionAnswerSchema = z
  .object({
    studySessionQuestionId: opaqueIdSchema,
    selectedOptionId: opaqueIdSchema.nullable(),
    elapsedSec: z.number().int().min(0).max(86_400)
  })
  .strict()

const submitStudySessionBodyObjectSchema = z
  .object({
    answers: z.array(submitStudySessionAnswerSchema).min(1).max(20),
    durationSec: z.number().int().min(0).max(604_800)
  })
  .strict()

const refineUniqueStudyAnswers = (
  { answers }: { answers: z.output<typeof submitStudySessionAnswerSchema>[] },
  context: z.RefinementCtx
): void => {
  const seenIds = new Set<string>()

  answers.forEach((answer, index) => {
    if (seenIds.has(answer.studySessionQuestionId)) {
      context.addIssue({
        code: 'custom',
        path: ['answers', index, 'studySessionQuestionId'],
        message: '같은 세션 문제의 답안을 중복 제출할 수 없습니다.',
        params: { contractCode: duplicateAnswerValidationMarker }
      })
    }

    seenIds.add(answer.studySessionQuestionId)
  })
}

export const submitStudySessionV2BodySchema = submitStudySessionBodyObjectSchema
  .extend({
    /**
     * Accepted and ignored: the server grades the answers as sent and does
     * not compare them with the saved draft. Removed after deploy (JLP-755).
     */
    expectedDraftRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional()
  })
  .superRefine(refineUniqueStudyAnswers)

export const submitStudySessionV2ResponseSchema = studyResultSchema

const submitStudySessionErrorCodeSchema = z.enum([
  'INVALID_JSON',
  'INVALID_REQUEST',
  'IDEMPOTENCY_KEY_REQUIRED',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'GUEST_SESSION_EXPIRED',
  'RESOURCE_NOT_FOUND',
  'IDEMPOTENCY_KEY_REUSED',
  'SESSION_ALREADY_SUBMITTED',
  'STUDY_SESSION_NOT_EDITABLE',
  'PRACTICE_CONTRACT_VERSION_MISMATCH',
  'VALIDATION_ERROR',
  'DUPLICATE_ANSWER',
  'ANSWER_NOT_IN_SESSION',
  'OPTION_NOT_IN_VERSION',
  'INVALID_DURATION',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const submitStudySessionV2ErrorCodeSchema = z.enum(
  submitStudySessionErrorCodeSchema.options
)

export const submitStudySessionV2ErrorSchema = createApiFailureSchema(
  submitStudySessionV2ErrorCodeSchema
)
export type ParsedSubmitStudySessionV2Body = z.output<
  typeof submitStudySessionV2BodySchema
>
export type SubmitStudySessionV2Response = z.output<
  typeof submitStudySessionV2ResponseSchema
>
export type SubmitStudySessionV2Error = z.output<
  typeof submitStudySessionV2ErrorSchema
>

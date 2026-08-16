import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { studyResultSchema } from './study-result.js'

export const submitStudySessionOperationId = 'study.submitStudySession' as const

export const duplicateAnswerValidationMarker = 'DUPLICATE_ANSWER' as const

export const submitStudySessionParamsSchema = z
  .object({ sessionId: opaqueIdSchema })
  .strict()

export const submitStudySessionHeadersSchema = z
  .object({ 'idempotency-key': opaqueIdSchema })
  .strict()

export const submitStudySessionAnswerSchema = z
  .object({
    studySessionQuestionId: opaqueIdSchema,
    selectedOptionId: opaqueIdSchema.nullable(),
    elapsedSec: z.number().int().min(0).max(86_400)
  })
  .strict()

export const submitStudySessionBodySchema = z
  .object({
    answers: z.array(submitStudySessionAnswerSchema).min(1).max(20),
    durationSec: z.number().int().min(0).max(604_800)
  })
  .strict()
  .superRefine(({ answers }, context) => {
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
  })

export const submitStudySessionResponseSchema = studyResultSchema

export const submitStudySessionErrorCodeSchema = z.enum([
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
  'VALIDATION_ERROR',
  'DUPLICATE_ANSWER',
  'ANSWER_NOT_IN_SESSION',
  'OPTION_NOT_IN_VERSION',
  'INVALID_DURATION',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const submitStudySessionErrorSchema = createApiFailureSchema(
  submitStudySessionErrorCodeSchema
)

export type SubmitStudySessionParams = z.input<
  typeof submitStudySessionParamsSchema
>
export type SubmitStudySessionHeaders = z.input<
  typeof submitStudySessionHeadersSchema
>
export type SubmitStudySessionBody = z.input<
  typeof submitStudySessionBodySchema
>
export type ParsedSubmitStudySessionBody = z.output<
  typeof submitStudySessionBodySchema
>
export type SubmitStudySessionResponse = z.output<
  typeof submitStudySessionResponseSchema
>
export type SubmitStudySessionError = z.output<
  typeof submitStudySessionErrorSchema
>

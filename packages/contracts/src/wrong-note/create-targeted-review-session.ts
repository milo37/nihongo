import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { createStudySessionV2ResponseSchema } from '../study/create-study-session.js'
import { idempotentPracticeContractV2HeadersSchema } from '../study/practice-contract.js'

export const createTargetedReviewSessionOperationId =
  'wrongNote.createTargetedReviewSession' as const

export const createTargetedReviewSessionParamsSchema = z
  .object({ questionId: opaqueIdSchema })
  .strict()

export const createTargetedReviewSessionHeadersSchema =
  idempotentPracticeContractV2HeadersSchema

export const createTargetedReviewSessionBodySchema = z.object({}).strict()

export const createTargetedReviewSessionResponseSchema =
  createStudySessionV2ResponseSchema.superRefine((response, context) => {
    const validTarget =
      response.session.mode === 'WRONG_NOTE' &&
      response.session.requestedCount === 1 &&
      response.session.actualCount === 1 &&
      response.session.usedFallback === false &&
      response.session.fallbackReason === null &&
      response.questions.length === 1

    if (!validTarget) {
      context.addIssue({
        code: 'custom',
        path: ['session'],
        message:
          'targeted review session은 fallback 없는 v2 WRONG_NOTE 단일 문제 세션이어야 합니다.'
      })
    }
  })

export const createTargetedReviewSessionResponseForQuestionSchema = (
  questionId: string
) => {
  const expectedQuestionId = opaqueIdSchema.parse(questionId)

  return createTargetedReviewSessionResponseSchema.superRefine(
    (response, context) => {
      if (response.questions[0]?.question.id !== expectedQuestionId) {
        context.addIssue({
          code: 'custom',
          path: ['questions', 0, 'question', 'id'],
          message:
            'targeted review response questionId는 요청 경로 questionId와 같아야 합니다.'
        })
      }
    }
  )
}

export const createTargetedReviewSessionLocationSchema = (sessionId: string) =>
  z.literal(
    `/api/v1/study-sessions/${opaqueIdSchema.parse(sessionId)}` as const
  )

export const createTargetedReviewSessionCanonicalMaterial = (
  questionId: string
): string => `study-targeted-review-v1\n${opaqueIdSchema.parse(questionId)}`

export const createTargetedReviewSessionErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'INVALID_JSON',
  'INVALID_REQUEST',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'INVALID_ID',
  'RESOURCE_NOT_FOUND',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'QUESTION_NOT_AVAILABLE',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const createTargetedReviewSessionErrorSchema = createApiFailureSchema(
  createTargetedReviewSessionErrorCodeSchema
)

export type CreateTargetedReviewSessionParams = z.input<
  typeof createTargetedReviewSessionParamsSchema
>
export type CreateTargetedReviewSessionHeaders = z.input<
  typeof createTargetedReviewSessionHeadersSchema
>
export type CreateTargetedReviewSessionBody = z.input<
  typeof createTargetedReviewSessionBodySchema
>
export type CreateTargetedReviewSessionResponse = z.output<
  typeof createTargetedReviewSessionResponseSchema
>
export type CreateTargetedReviewSessionError = z.output<
  typeof createTargetedReviewSessionErrorSchema
>

import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  nonNegativeSafeIntegerSchema,
  rowVersionSchema
} from '../common/content-validation.js'

export const completeQuestionReviewOperationId =
  'admin.completeQuestionReview' as const
export const holdQuestionReviewOperationId = 'admin.holdQuestionReview' as const
export const publishQuestionVersionBatchOperationId =
  'admin.publishQuestionVersionBatch' as const
export const deleteQuestionDraftOperationId =
  'admin.deleteQuestionDraft' as const

/**
 * One person flow. Internal version states map to:
 * DRAFT·IN_REVIEW·CHANGES_REQUESTED → AUTO_VALIDATED, APPROVED → REVIEWED,
 * PUBLISHED → PUBLISHED, RETIRED → RETIRED (history only).
 * A successful content update returns to AUTO_VALIDATED.
 */
export const questionReviewStageSchema = z.enum([
  'AUTO_VALIDATED',
  'REVIEWED',
  'PUBLISHED',
  'RETIRED'
])

export const autoValidationIssueSchema = z
  .object({
    field: z.string().min(1).max(200),
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(500)
  })
  .strict()

export const autoValidationResultSchema = z
  .object({
    passed: z.boolean(),
    issues: z.array(autoValidationIssueSchema).max(100)
  })
  .strict()
  .refine((result) => result.passed === (result.issues.length === 0), {
    path: ['passed'],
    message: '통과일 때만 이슈 목록이 비어 있어야 합니다.'
  })

/** Added to admin question summaries, version summaries and detail. */
export const adminQuestionReviewStateSchema = z
  .object({
    reviewStage: questionReviewStageSchema,
    autoValidation: autoValidationResultSchema,
    /** Submitted study answers for this question; > 0 means retire/archive only. */
    usageCount: nonNegativeSafeIntegerSchema
  })
  .strict()

export const questionVersionParamsSchema = z
  .object({ versionId: opaqueIdSchema })
  .strict()

export const completeQuestionReviewRequestSchema = z
  .object({
    expectedRowVersion: rowVersionSchema,
    checks: z
      .object({
        answerChecked: z.literal(true),
        explanationChecked: z.literal(true),
        levelAndTagsChecked: z.literal(true)
      })
      .strict()
  })
  .strict()

export const holdQuestionReviewRequestSchema = z
  .object({ expectedRowVersion: rowVersionSchema })
  .strict()

export const questionReviewMutationResultSchema = z
  .object({
    questionVersionId: opaqueIdSchema,
    reviewStage: questionReviewStageSchema,
    rowVersion: rowVersionSchema
  })
  .strict()

export const completeQuestionReviewResponseSchema =
  questionReviewMutationResultSchema
export const holdQuestionReviewResponseSchema =
  questionReviewMutationResultSchema

/** Review commands do not require re-authentication. */
export const questionReviewErrorSchema = createApiFailureSchema(
  z.enum([
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'ADMIN_REQUIRED',
    'INVALID_CSRF',
    'UNTRUSTED_ORIGIN',
    'VALIDATION_ERROR',
    'RESOURCE_NOT_FOUND',
    'VERSION_CONFLICT',
    'INVALID_STATE_TRANSITION',
    'RATE_LIMITED',
    'INTERNAL_SERVER_ERROR',
    'SERVICE_UNAVAILABLE'
  ])
)

export const publishQuestionVersionBatchRequestSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            questionVersionId: opaqueIdSchema,
            expectedRowVersion: rowVersionSchema
          })
          .strict()
      )
      .min(1)
      .max(100)
      .refine(
        (items) =>
          new Set(items.map(({ questionVersionId }) => questionVersionId))
            .size === items.length,
        'questionVersionId는 중복될 수 없습니다.'
      )
  })
  .strict()

export const publishQuestionVersionBatchItemResultSchema = z.enum([
  'PUBLISHED',
  'VERSION_CONFLICT',
  'NOT_REVIEWED',
  'NOT_FOUND',
  /** Unexpected failure after an earlier item was published; reload and retry. */
  'FAILED'
])

/**
 * Items are committed one by one; the batch is not atomic. A single operator
 * may publish their own approved version (JLP-704). An error response
 * means nothing was published; once an item is published, later unexpected
 * failures are reported per item as FAILED.
 */
export const publishQuestionVersionBatchResponseSchema = z
  .object({
    publishedCount: nonNegativeSafeIntegerSchema,
    items: z
      .array(
        z
          .object({
            questionVersionId: opaqueIdSchema,
            result: publishQuestionVersionBatchItemResultSchema,
            rowVersion: rowVersionSchema.nullable()
          })
          .strict()
      )
      .min(1)
      .max(100)
  })
  .strict()
  .refine(
    (response) =>
      response.publishedCount ===
      response.items.filter(({ result }) => result === 'PUBLISHED').length,
    { path: ['publishedCount'], message: 'publishedCount가 결과와 달라요.' }
  )

/** Error schema: `publishQuestionVersionBatchErrorSchema` in content-commands. */

/**
 * POST /admin/question-versions/:versionId/draft-deletion.
 * Only a never published draft with usageCount 0 can be deleted.
 */
export const deleteQuestionDraftRequestSchema = z
  .object({ expectedRowVersion: rowVersionSchema })
  .strict()

export const deleteQuestionDraftResponseSchema = z
  .object({ questionVersionId: opaqueIdSchema, deleted: z.literal(true) })
  .strict()

export const deleteQuestionDraftErrorSchema = createApiFailureSchema(
  z.enum([
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'ADMIN_REQUIRED',
    'INVALID_CSRF',
    'UNTRUSTED_ORIGIN',
    'VALIDATION_ERROR',
    'RESOURCE_NOT_FOUND',
    'VERSION_CONFLICT',
    'INVALID_STATE_TRANSITION',
    'RATE_LIMITED',
    'INTERNAL_SERVER_ERROR',
    'SERVICE_UNAVAILABLE'
  ])
)

export type QuestionReviewStage = z.output<typeof questionReviewStageSchema>
export type AutoValidationResult = z.output<typeof autoValidationResultSchema>
export type AdminQuestionReviewState = z.output<
  typeof adminQuestionReviewStateSchema
>
export type CompleteQuestionReviewRequest = z.input<
  typeof completeQuestionReviewRequestSchema
>
export type HoldQuestionReviewRequest = z.input<
  typeof holdQuestionReviewRequestSchema
>
export type QuestionReviewMutationResult = z.output<
  typeof questionReviewMutationResultSchema
>
export type PublishQuestionVersionBatchRequest = z.input<
  typeof publishQuestionVersionBatchRequestSchema
>
export type PublishQuestionVersionBatchResponse = z.output<
  typeof publishQuestionVersionBatchResponseSchema
>
export type DeleteQuestionDraftRequest = z.input<
  typeof deleteQuestionDraftRequestSchema
>
export type DeleteQuestionDraftResponse = z.output<
  typeof deleteQuestionDraftResponseSchema
>

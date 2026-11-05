import { z } from 'zod'
import { opaqueIdSchema } from '../common/id.js'
import {
  nonNegativeSafeIntegerSchema,
  rowVersionSchema
} from '../common/content-validation.js'

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

const autoValidationIssueSchema = z
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

const publishQuestionVersionBatchItemResultSchema = z.enum([
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

export type QuestionReviewStage = z.output<typeof questionReviewStageSchema>
export type AutoValidationResult = z.output<typeof autoValidationResultSchema>
export type PublishQuestionVersionBatchRequest = z.input<
  typeof publishQuestionVersionBatchRequestSchema
>
export type PublishQuestionVersionBatchResponse = z.output<
  typeof publishQuestionVersionBatchResponseSchema
>

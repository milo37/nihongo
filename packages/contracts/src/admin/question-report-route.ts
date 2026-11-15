import { z } from 'zod'
import { assertContentDateRange, isoDateTimeSchema } from '../common/date.js'
import { opaqueIdSchema } from '../common/id.js'

/**
 * The admin report list query and detail params, kept apart from
 * content-future so the login return-path check can use them without
 * pulling the admin content contracts into the learner bundle (#1053).
 */
const addIssue = (
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
  message: string
): void => context.addIssue({ code: 'custom', path, message })

export const questionReportReasonSchema = z.enum([
  'ANSWER_ERROR',
  'EXPLANATION_ERROR',
  'TYPO_OR_GRAMMAR',
  'AMBIGUOUS',
  'LEVEL_OR_TAXONOMY',
  'OTHER'
])
export const questionReportStatusSchema = z.enum([
  'OPEN',
  'TRIAGED',
  'RESOLVED',
  'DISMISSED'
])

const adminQuestionReportSortSchema = z.enum(['UPDATED_DESC', 'CREATED_DESC'])
export const listAdminQuestionReportsQuerySchema = z
  .object({
    status: questionReportStatusSchema.optional(),
    reason: questionReportReasonSchema.optional(),
    questionId: opaqueIdSchema.optional(),
    assigneeActorId: opaqueIdSchema.optional(),
    createdFrom: isoDateTimeSchema.optional(),
    createdTo: isoDateTimeSchema.optional(),
    updatedFrom: isoDateTimeSchema.optional(),
    updatedTo: isoDateTimeSchema.optional(),
    sort: adminQuestionReportSortSchema.default('UPDATED_DESC'),
    page: z.coerce
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict()
  .superRefine((query, context) => {
    try {
      assertContentDateRange(query.createdFrom, query.createdTo)
      assertContentDateRange(query.updatedFrom, query.updatedTo)
    } catch (error) {
      addIssue(
        context,
        [],
        error instanceof Error ? error.message : 'invalid range'
      )
    }
  })

export const getAdminQuestionReportParamsSchema = z
  .object({ reportId: opaqueIdSchema })
  .strict()

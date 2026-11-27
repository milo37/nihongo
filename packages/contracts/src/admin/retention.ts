import { z } from 'zod'
import { calendarDateSchema } from '../common/date.js'
import { nonNegativeSafeIntegerSchema } from '../common/content-validation.js'

/** Weeks of cohort days GET /admin/retention shows, counted back from today. */
export const ADMIN_RETENTION_WEEKS = 8

const adminRetentionAudienceSchema = z.enum(['MEMBER', 'GUEST'])

export const getAdminRetentionQuerySchema = z.object({}).strict()

/**
 * One cohort day of one audience, as the #1042 count wrote it. Numbers only:
 * no person, id or session. `weekCohortSize`, `day7Returned` and `week1Returned`
 * are null until day 7 of the cohort has passed. Rows are newest day first,
 * members before guests.
 */
const adminRetentionRowSchema = z
  .object({
    cohortDate: calendarDateSchema,
    audience: adminRetentionAudienceSchema,
    cohortSize: nonNegativeSafeIntegerSchema,
    day1Returned: nonNegativeSafeIntegerSchema,
    weekCohortSize: nonNegativeSafeIntegerSchema.nullable(),
    day7Returned: nonNegativeSafeIntegerSchema.nullable(),
    week1Returned: nonNegativeSafeIntegerSchema.nullable()
  })
  .strict()

export const getAdminRetentionResponseSchema = z
  .object({
    rows: z.array(adminRetentionRowSchema).max(ADMIN_RETENTION_WEEKS * 7 * 2)
  })
  .strict()

export type AdminRetentionAudience = z.output<
  typeof adminRetentionAudienceSchema
>
export type AdminRetentionRow = z.output<typeof adminRetentionRowSchema>
export type GetAdminRetentionResponse = z.output<
  typeof getAdminRetentionResponseSchema
>

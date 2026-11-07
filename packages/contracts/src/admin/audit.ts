import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import { opaqueIdSchema } from '../common/id.js'
import { contentOccurredAtCursorSchema } from '../common/content-cursor.js'

/**
 * Reduced admin activity log for GET /admin/audit-log. Rows are kept one year.
 * FAILURE is only recorded for ADMIN_SIGN_IN and re-authentication; failed
 * commands roll back and leave no row.
 */
const adminActivityActionSchema = z.enum([
  'PUBLISH',
  'UPDATE',
  'DELETE_OR_ARCHIVE',
  'MEMBER_RESTRICT',
  'MEMBER_UNRESTRICT',
  'ADMIN_SIGN_IN'
])

const adminActivityResultSchema = z.enum(['SUCCESS', 'FAILURE'])

export const listAdminActivityQuerySchema = z
  .object({
    cursor: contentOccurredAtCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
  .strict()

const adminActivityItemSchema = z
  .object({
    occurredAt: isoDateTimeSchema,
    action: adminActivityActionSchema,
    targetLabel: z.string().min(1).max(200),
    targetId: opaqueIdSchema.nullable(),
    result: adminActivityResultSchema
  })
  .strict()

export const listAdminActivityResponseSchema = z
  .object({
    items: z.array(adminActivityItemSchema).max(50),
    nextCursor: contentOccurredAtCursorSchema.nullable()
  })
  .strict()

export type AdminActivityAction = z.output<typeof adminActivityActionSchema>
export type AdminActivityItem = z.output<typeof adminActivityItemSchema>
export type ListAdminActivityResponse = z.output<
  typeof listAdminActivityResponseSchema
>

import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { phase7OccurredAtCursorSchema } from '../common/content-cursor.js'

/**
 * Reduced admin activity log for GET /admin/audit-log. Rows are kept one year.
 * FAILURE is only recorded for ADMIN_SIGN_IN and re-authentication; failed
 * commands roll back and leave no row.
 */
export const adminActivityActionSchema = z.enum([
  'PUBLISH',
  'UPDATE',
  'DELETE_OR_ARCHIVE',
  'MEMBER_RESTRICT',
  'MEMBER_UNRESTRICT',
  'ADMIN_SIGN_IN'
])

export const adminActivityResultSchema = z.enum(['SUCCESS', 'FAILURE'])

export const listAdminActivityQuerySchema = z
  .object({
    cursor: phase7OccurredAtCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
  .strict()

export const adminActivityItemSchema = z
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
    nextCursor: phase7OccurredAtCursorSchema.nullable()
  })
  .strict()

export const listAdminActivityErrorSchema = createApiFailureSchema(
  z.enum([
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'ADMIN_REQUIRED',
    'VALIDATION_ERROR',
    'RATE_LIMITED',
    'INTERNAL_SERVER_ERROR',
    'SERVICE_UNAVAILABLE'
  ])
)

export type AdminActivityAction = z.output<typeof adminActivityActionSchema>
export type ListAdminActivityQuery = z.input<
  typeof listAdminActivityQuerySchema
>
export type AdminActivityItem = z.output<typeof adminActivityItemSchema>
export type ListAdminActivityResponse = z.output<
  typeof listAdminActivityResponseSchema
>

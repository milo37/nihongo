import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  createContentTextSchema,
  rowVersionSchema
} from '../common/content-validation.js'
import { createPageResponseSchema } from '../common/pagination.js'
import {
  reportKindSchema,
  reportStatusSchema,
  reportTextSchema
} from '../report/reports.js'

export const listAdminReportsOperationId = 'admin.listAdminReports' as const
export const getAdminReportOperationId = 'admin.getAdminReport' as const
export const replyAndCloseAdminReportOperationId =
  'admin.replyAndCloseAdminReport' as const
export const saveAdminReportNoteOperationId =
  'admin.saveAdminReportNote' as const
export const closeAdminReportOperationId = 'admin.closeAdminReport' as const

/** Sorted RECEIVED first, then createdAt desc, then reportId desc. */
export const listAdminReportsQuerySchema = z
  .object({
    status: reportStatusSchema.optional(),
    kind: reportKindSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
  })
  .strict()

export const adminReportSummarySchema = z
  .object({
    reportId: opaqueIdSchema,
    kind: reportKindSchema,
    status: reportStatusSchema,
    location: createContentTextSchema({ maxScalars: 200 }),
    questionId: opaqueIdSchema.nullable(),
    questionVersionId: opaqueIdSchema.nullable(),
    descriptionPreview: createContentTextSchema({ maxScalars: 160 }),
    reporterMemberId: opaqueIdSchema.nullable(),
    createdAt: isoDateTimeSchema,
    rowVersion: rowVersionSchema
  })
  .strict()

export const listAdminReportsResponseSchema = createPageResponseSchema(
  adminReportSummarySchema
)

export const adminReportParamsSchema = z
  .object({ reportId: opaqueIdSchema })
  .strict()

export const adminReportDetailSchema = adminReportSummarySchema
  .omit({ descriptionPreview: true })
  .extend({
    description: reportTextSchema,
    reporterReply: reportTextSchema.nullable(),
    repliedAt: isoDateTimeSchema.nullable(),
    internalNote: reportTextSchema.nullable(),
    closedAt: isoDateTimeSchema.nullable(),
    updatedAt: isoDateTimeSchema
  })
  .strict()

export const getAdminReportResponseSchema = adminReportDetailSchema

const optionalNoteSchema = createContentTextSchema({
  minScalars: 0,
  maxScalars: 1000,
  multiline: true
}).optional()

export const replyAndCloseAdminReportRequestSchema = z
  .object({
    expectedRowVersion: rowVersionSchema,
    reporterReply: reportTextSchema,
    internalNote: optionalNoteSchema
  })
  .strict()

/** Keeps the current status. An empty note clears it. */
export const saveAdminReportNoteRequestSchema = z
  .object({
    expectedRowVersion: rowVersionSchema,
    internalNote: createContentTextSchema({
      minScalars: 0,
      maxScalars: 1000,
      multiline: true
    })
  })
  .strict()

export const closeAdminReportRequestSchema = z
  .object({
    expectedRowVersion: rowVersionSchema,
    internalNote: optionalNoteSchema
  })
  .strict()

export const adminReportMutationResponseSchema = adminReportDetailSchema

/** No re-authentication. Closed reports reject commands. */
export const adminReportErrorSchema = createApiFailureSchema(
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

export type ListAdminReportsQuery = z.input<typeof listAdminReportsQuerySchema>
export type AdminReportSummary = z.output<typeof adminReportSummarySchema>
export type ListAdminReportsResponse = z.output<
  typeof listAdminReportsResponseSchema
>
export type AdminReportDetail = z.output<typeof adminReportDetailSchema>
export type ReplyAndCloseAdminReportRequest = z.input<
  typeof replyAndCloseAdminReportRequestSchema
>
export type SaveAdminReportNoteRequest = z.input<
  typeof saveAdminReportNoteRequestSchema
>
export type CloseAdminReportRequest = z.input<
  typeof closeAdminReportRequestSchema
>

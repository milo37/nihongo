import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { createContentTextSchema } from '../common/content-validation.js'
import { createPageResponseSchema } from '../common/pagination.js'

export const createReportOperationId = 'report.createReport' as const
export const listMyReportsOperationId = 'report.listMyReports' as const

export const reportKindSchema = z.enum(['QUESTION', 'APP_ERROR'])

/** RECEIVED → ANSWERED (replied and closed) | CLOSED (closed without reply). */
export const reportStatusSchema = z.enum(['RECEIVED', 'ANSWERED', 'CLOSED'])

export const reportTextSchema = createContentTextSchema({
  maxScalars: 1000,
  multiline: true
})

export const createReportRequestSchema = z
  .object({
    kind: reportKindSchema,
    location: createContentTextSchema({ maxScalars: 200 }),
    questionId: opaqueIdSchema.optional(),
    questionVersionId: opaqueIdSchema.optional(),
    description: reportTextSchema
  })
  .strict()
  .refine(
    (report) =>
      report.kind === 'QUESTION'
        ? report.questionId !== undefined &&
          report.questionVersionId !== undefined
        : report.questionId === undefined &&
          report.questionVersionId === undefined,
    {
      path: ['questionVersionId'],
      message: '문항 제보에만 문항과 버전이 있어야 합니다.'
    }
  )

export const createReportResponseSchema = z
  .object({
    reportId: opaqueIdSchema,
    status: z.literal('RECEIVED'),
    createdAt: isoDateTimeSchema
  })
  .strict()

/** ACCOUNT_RESTRICTED: signed in member is temporarily restricted. */
export const createReportErrorSchema = createApiFailureSchema(
  z.enum([
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'ACCOUNT_RESTRICTED',
    'INVALID_CSRF',
    'UNTRUSTED_ORIGIN',
    'VALIDATION_ERROR',
    'QUESTION_NOT_AVAILABLE',
    'QUESTION_REPORT_DUPLICATE',
    'RATE_LIMITED',
    'INTERNAL_SERVER_ERROR',
    'SERVICE_UNAVAILABLE'
  ])
)

export const listMyReportsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20)
  })
  .strict()

/** Learner view. The admin internal note is never part of this schema. */
export const myReportSchema = z
  .object({
    reportId: opaqueIdSchema,
    kind: reportKindSchema,
    createdAt: isoDateTimeSchema,
    status: reportStatusSchema,
    reporterReply: reportTextSchema.nullable(),
    repliedAt: isoDateTimeSchema.nullable()
  })
  .strict()
  .refine(
    (report) =>
      (report.status === 'ANSWERED') ===
      (report.reporterReply !== null && report.repliedAt !== null),
    { path: ['reporterReply'], message: 'ANSWERED에만 답변이 있어야 합니다.' }
  )

export const listMyReportsResponseSchema =
  createPageResponseSchema(myReportSchema)

export const listMyReportsErrorSchema = createApiFailureSchema(
  z.enum([
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'VALIDATION_ERROR',
    'RATE_LIMITED',
    'INTERNAL_SERVER_ERROR',
    'SERVICE_UNAVAILABLE'
  ])
)

export type ReportKind = z.output<typeof reportKindSchema>
export type ReportStatus = z.output<typeof reportStatusSchema>
export type CreateReportRequest = z.input<typeof createReportRequestSchema>
export type CreateReportResponse = z.output<typeof createReportResponseSchema>
export type ListMyReportsQuery = z.input<typeof listMyReportsQuerySchema>
export type MyReport = z.output<typeof myReportSchema>
export type ListMyReportsResponse = z.output<typeof listMyReportsResponseSchema>

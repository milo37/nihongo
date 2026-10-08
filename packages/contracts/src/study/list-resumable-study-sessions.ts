import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import {
  jlptLevelSchema,
  practiceContractVersionSchema,
  questionSubjectSchema,
  studyModeSchema,
  studyResumeAvailabilitySchema
} from '../common/enum.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  createPageResponseSchema,
  pageRequestSchema
} from '../common/pagination.js'
import { practiceContractV2HeadersSchema } from './practice-contract.js'

export const listResumableStudySessionsOperationId =
  'study.listResumableStudySessions' as const

export const listResumableStudySessionsHeadersSchema =
  practiceContractV2HeadersSchema

export const listResumableStudySessionsQuerySchema = pageRequestSchema
  .extend({ status: z.literal('IN_PROGRESS') })
  .strict()

export const resumableStudySessionSummarySchema = z
  .object({
    id: opaqueIdSchema,
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    mode: studyModeSchema,
    status: z.literal('IN_PROGRESS'),
    actualCount: z.number().int().min(1).max(20),
    startedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    practiceContractVersion: practiceContractVersionSchema,
    draftRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    draftSavedAt: isoDateTimeSchema.nullable(),
    currentOrdinal: z.number().int().min(1).max(20).nullable(),
    resumeAvailability: studyResumeAvailabilitySchema
  })
  .strict()
  .superRefine((summary, context) => {
    if (Date.parse(summary.expiresAt) <= Date.parse(summary.startedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'expiresAt은 startedAt보다 이후여야 합니다.'
      })
    }

    if (
      summary.currentOrdinal !== null &&
      summary.currentOrdinal > summary.actualCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['currentOrdinal'],
        message: 'currentOrdinal은 actualCount 범위 안이어야 합니다.'
      })
    }

    const isLegacy = summary.practiceContractVersion === 1
    const hasLegacyShape =
      summary.draftRevision === null &&
      summary.draftSavedAt === null &&
      summary.currentOrdinal === null &&
      summary.resumeAvailability === 'LEGACY_LOCAL_ONLY'
    const hasServerShape =
      summary.draftRevision !== null &&
      summary.currentOrdinal !== null &&
      summary.resumeAvailability === 'SERVER' &&
      ((summary.draftRevision === 0 && summary.draftSavedAt === null) ||
        (summary.draftRevision > 0 && summary.draftSavedAt !== null))

    if ((isLegacy && !hasLegacyShape) || (!isLegacy && !hasServerShape)) {
      context.addIssue({
        code: 'custom',
        path: ['practiceContractVersion'],
        message: 'contract version과 resume metadata가 일치해야 합니다.'
      })
    }
  })

export const listResumableStudySessionsResponseSchema =
  createPageResponseSchema(resumableStudySessionSummarySchema).superRefine(
    (page, context) => {
      const offset = (page.page - 1) * page.pageSize
      const remainingItems = Math.max(page.total - offset, 0)
      const maximumItemsOnPage = Math.min(page.pageSize, remainingItems)

      if (page.items.length !== maximumItemsOnPage) {
        context.addIssue({
          code: 'custom',
          path: ['items'],
          message:
            'resumable page count가 pagination metadata와 일치해야 합니다.'
        })
      }

      const ids = new Set<string>()
      page.items.forEach((item, index) => {
        if (ids.has(item.id)) {
          context.addIssue({
            code: 'custom',
            path: ['items', index, 'id'],
            message: 'resumable session ID는 page 안에서 서로 달라야 합니다.'
          })
        }
        ids.add(item.id)
      })
    }
  )

export const listResumableStudySessionsErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'GUEST_SESSION_EXPIRED',
  'INVALID_REQUEST',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const listResumableStudySessionsErrorSchema = createApiFailureSchema(
  listResumableStudySessionsErrorCodeSchema
)

export type ListResumableStudySessionsHeaders = z.input<
  typeof listResumableStudySessionsHeadersSchema
>
export type ListResumableStudySessionsQuery = z.input<
  typeof listResumableStudySessionsQuerySchema
>
export type ParsedListResumableStudySessionsQuery = z.output<
  typeof listResumableStudySessionsQuerySchema
>
export type ResumableStudySessionSummary = z.output<
  typeof resumableStudySessionSummarySchema
>
export type ListResumableStudySessionsResponse = z.output<
  typeof listResumableStudySessionsResponseSchema
>
export type ListResumableStudySessionsError = z.output<
  typeof listResumableStudySessionsErrorSchema
>

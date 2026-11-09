import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import {
  jlptLevelSchema,
  questionSubjectSchema,
  questionTypeSchema,
  type WrongNoteStatus
} from '../common/enum.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  createPageResponseSchema,
  pageRequestSchema
} from '../common/pagination.js'
import { wrongNoteQuestionPreviewSchema } from './list-wrong-notes.js'

/**
 * Wrong notes in two states (JLP-812): wrong answers wait in TO_REVIEW; one
 * right answer in any study moves them to REVIEWED, a wrong one moves them
 * back. The stored four statuses stay and are grouped here.
 */
export const wrongNoteReviewStateSchema = z.enum(['TO_REVIEW', 'REVIEWED'])

export type WrongNoteReviewState = z.output<typeof wrongNoteReviewStateSchema>

/** NEW and AGAIN wait for review; REVIEWING and SOLVED were answered right. */
export const toWrongNoteReviewState = (
  status: WrongNoteStatus
): WrongNoteReviewState =>
  status === 'NEW' || status === 'AGAIN' ? 'TO_REVIEW' : 'REVIEWED'

const safeNonNegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

export const listReviewListOperationId = 'wrongNote.listReviewList' as const

/** GET /api/v1/review-list?state=TO_REVIEW&level=N5&page=1&pageSize=20 */
export const listReviewListQuerySchema = pageRequestSchema
  .extend({
    state: wrongNoteReviewStateSchema.default('TO_REVIEW'),
    level: jlptLevelSchema.optional()
  })
  .strict()

export const reviewListItemSchema = z
  .object({
    questionId: opaqueIdSchema,
    currentQuestionVersionId: opaqueIdSchema,
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    questionType: questionTypeSchema,
    questionPreview: wrongNoteQuestionPreviewSchema,
    reviewState: wrongNoteReviewStateSchema,
    wrongCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    lastWrongAt: isoDateTimeSchema,
    /** Last right answer; set for every REVIEWED item. */
    lastReviewedAt: isoDateTimeSchema.nullable()
  })
  .strict()
  .superRefine((item, context) => {
    if (item.reviewState === 'REVIEWED' && item.lastReviewedAt === null) {
      context.addIssue({
        code: 'custom',
        path: ['lastReviewedAt'],
        message: '복습한 문제에는 맞힌 시각이 있어야 합니다.'
      })
    }
  })

const reviewListCountsSchema = z
  .object({
    toReview: safeNonNegativeIntegerSchema,
    reviewed: safeNonNegativeIntegerSchema
  })
  .strict()

/** Level and subject of the oldest wrong answer to review: where to start. */
const oldestToReviewSchema = z
  .object({
    level: jlptLevelSchema,
    subject: questionSubjectSchema
  })
  .strict()

export const listReviewListResponseSchema = createPageResponseSchema(
  reviewListItemSchema
)
  .extend({
    state: wrongNoteReviewStateSchema,
    counts: reviewListCountsSchema,
    oldestToReview: oldestToReviewSchema.nullable(),
    observedAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((page, context) => {
    const expectedTotal =
      page.state === 'TO_REVIEW' ? page.counts.toReview : page.counts.reviewed
    if (page.total !== expectedTotal) {
      context.addIssue({
        code: 'custom',
        path: ['total'],
        message: 'total은 고른 탭의 개수와 같아야 합니다.'
      })
    }
    if ((page.counts.toReview === 0) !== (page.oldestToReview === null)) {
      context.addIssue({
        code: 'custom',
        path: ['oldestToReview'],
        message: '복습할 문제가 있을 때만 시작 급수·과목이 있습니다.'
      })
    }
    const questionIds = new Set<string>()
    page.items.forEach((item, index) => {
      if (item.reviewState !== page.state) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'reviewState'],
          message: '목록 항목은 고른 탭의 상태여야 합니다.'
        })
      }
      if (questionIds.has(item.questionId)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'questionId'],
          message: '같은 문제가 두 번 나올 수 없습니다.'
        })
      }
      questionIds.add(item.questionId)
    })
  })

export const listReviewListErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const listReviewListErrorSchema = createApiFailureSchema(
  listReviewListErrorCodeSchema
)

export type ListReviewListQuery = z.input<typeof listReviewListQuerySchema>
export type ParsedListReviewListQuery = z.output<
  typeof listReviewListQuerySchema
>
export type ReviewListItem = z.output<typeof reviewListItemSchema>
export type ReviewListCounts = z.output<typeof reviewListCountsSchema>
export type ListReviewListResponse = z.output<
  typeof listReviewListResponseSchema
>

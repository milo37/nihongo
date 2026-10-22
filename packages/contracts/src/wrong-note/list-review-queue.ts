import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import {
  jlptLevelSchema,
  questionSubjectSchema,
  questionTypeSchema,
  reviewQueueSortSchema,
  reviewQueueViewSchema,
  wrongNoteStatusSchema,
  type ReviewQueueSort
} from '../common/enum.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  createPageResponseSchema,
  pageRequestSchema
} from '../common/pagination.js'
import {
  createSortedUniqueWrongNoteTagLabelsSchema,
  wrongNoteQuestionPreviewSchema,
  wrongNoteTagLabelSchema
} from './list-wrong-notes.js'

const safeNonNegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

const safePositiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)

export const listReviewQueueOperationId = 'wrongNote.listReviewQueue' as const

export const listReviewQueueQuerySchema = pageRequestSchema
  .extend({
    view: reviewQueueViewSchema.default('DUE'),
    level: jlptLevelSchema.optional(),
    subject: questionSubjectSchema.optional(),
    questionType: questionTypeSchema.optional(),
    tag: wrongNoteTagLabelSchema.optional(),
    sort: reviewQueueSortSchema.default('NEXT_REVIEW')
  })
  .strict()
  .superRefine((query, context) => {
    if (!Number.isSafeInteger(query.page)) {
      context.addIssue({
        code: 'custom',
        path: ['page'],
        message: 'page는 safe integer여야 합니다.'
      })
    }
  })

export const reviewQueueCountsSchema = z
  .object({
    due: safeNonNegativeIntegerSchema,
    unreviewed: safeNonNegativeIntegerSchema,
    repeated: safeNonNegativeIntegerSchema,
    solved: safeNonNegativeIntegerSchema
  })
  .strict()

export const reviewQueueItemSchema = z
  .object({
    questionId: opaqueIdSchema,
    currentQuestionVersionId: opaqueIdSchema,
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    questionType: questionTypeSchema,
    questionPreview: wrongNoteQuestionPreviewSchema,
    tags: createSortedUniqueWrongNoteTagLabelsSchema(1),
    status: wrongNoteStatusSchema,
    wrongCount: safePositiveIntegerSchema,
    correctStreak: safeNonNegativeIntegerSchema,
    lastWrongAt: isoDateTimeSchema,
    lastReviewedAt: isoDateTimeSchema.nullable(),
    nextReviewAt: isoDateTimeSchema,
    hasMemo: z.boolean()
  })
  .strict()
  .superRefine((item, context) => {
    const validState =
      (item.status === 'NEW' &&
        item.wrongCount === 1 &&
        item.correctStreak === 0 &&
        item.lastReviewedAt === null) ||
      (item.status === 'AGAIN' &&
        item.wrongCount >= 2 &&
        item.correctStreak === 0 &&
        item.lastReviewedAt !== null) ||
      (item.status === 'REVIEWING' &&
        item.correctStreak === 1 &&
        item.lastReviewedAt !== null) ||
      (item.status === 'SOLVED' &&
        item.correctStreak >= 2 &&
        item.lastReviewedAt !== null)

    if (!validState) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'review queue 상태와 count·review 시각이 일치해야 합니다.'
      })
    }

    if (
      item.lastReviewedAt !== null &&
      item.lastReviewedAt < item.lastWrongAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lastReviewedAt'],
        message: '마지막 review 시각은 마지막 오답 시각보다 빠를 수 없습니다.'
      })
    }
  })

const statusPriority = {
  AGAIN: 0,
  NEW: 1,
  REVIEWING: 2,
  SOLVED: 3
} as const

const compareAscending = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1

export const compareReviewQueueItems = (
  left: z.output<typeof reviewQueueItemSchema>,
  right: z.output<typeof reviewQueueItemSchema>,
  sort: ReviewQueueSort
): number => {
  if (sort === 'NEXT_REVIEW') {
    return (
      compareAscending(left.nextReviewAt, right.nextReviewAt) ||
      statusPriority[left.status] - statusPriority[right.status] ||
      compareAscending(left.questionId, right.questionId)
    )
  }

  if (sort === 'MOST_WRONG') {
    return (
      right.wrongCount - left.wrongCount ||
      compareAscending(right.lastWrongAt, left.lastWrongAt) ||
      compareAscending(left.questionId, right.questionId)
    )
  }

  return (
    compareAscending(right.lastWrongAt, left.lastWrongAt) ||
    compareAscending(left.questionId, right.questionId)
  )
}

export const listReviewQueueResponseSchema = createPageResponseSchema(
  reviewQueueItemSchema
)
  .extend({
    counts: reviewQueueCountsSchema,
    availableTags: createSortedUniqueWrongNoteTagLabelsSchema(0),
    observedAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((page, context) => {
    if (!Number.isSafeInteger(page.page)) {
      context.addIssue({
        code: 'custom',
        path: ['page'],
        message: 'page는 safe integer여야 합니다.'
      })
      return
    }

    const offset = (BigInt(page.page) - 1n) * BigInt(page.pageSize)
    const remaining = BigInt(page.total) - offset
    const expectedCount =
      remaining <= 0n
        ? 0
        : Number(
            remaining < BigInt(page.pageSize)
              ? remaining
              : BigInt(page.pageSize)
          )

    if (page.items.length !== expectedCount) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message:
          'review queue page count가 pagination metadata와 일치해야 합니다.'
      })
    }

    const questionIds = new Set<string>()
    const availableTags = new Set(page.availableTags)
    page.items.forEach((item, index) => {
      if (questionIds.has(item.questionId)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'questionId'],
          message: 'review queue question ID는 page 안에서 서로 달라야 합니다.'
        })
      }
      questionIds.add(item.questionId)

      item.tags.forEach((tag) => {
        if (!availableTags.has(tag)) {
          context.addIssue({
            code: 'custom',
            path: ['items', index, 'tags'],
            message:
              'review queue item tag는 availableTags에 포함되어야 합니다.'
          })
        }
      })
    })
  })

export const listReviewQueueErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const listReviewQueueErrorSchema = createApiFailureSchema(
  listReviewQueueErrorCodeSchema
)

export type ListReviewQueueQuery = z.input<typeof listReviewQueueQuerySchema>
export type ParsedListReviewQueueQuery = z.output<
  typeof listReviewQueueQuerySchema
>
export type ReviewQueueCounts = z.output<typeof reviewQueueCountsSchema>
export type ReviewQueueItem = z.output<typeof reviewQueueItemSchema>
export type ListReviewQueueResponse = z.output<
  typeof listReviewQueueResponseSchema
>
export type ListReviewQueueError = z.output<typeof listReviewQueueErrorSchema>

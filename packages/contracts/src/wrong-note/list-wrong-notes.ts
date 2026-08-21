import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import {
  jlptLevelSchema,
  questionSubjectSchema,
  questionTypeSchema,
  reviewAvailabilitySchema,
  wrongNoteSortSchema,
  wrongNoteStatusSchema
} from '../common/enum.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  createPageResponseSchema,
  pageRequestSchema
} from '../common/pagination.js'
const nonBlankTextSchema = z.string().trim().min(1)
const ASCII_EDGE_SPACES_PATTERN = /^ +| +$/gu

export const trimWrongNoteTagLabel = (value: string): string =>
  value.replace(ASCII_EDGE_SPACES_PATTERN, '')

export const wrongNoteTagLabelSchema = z
  .string()
  .transform(trimWrongNoteTagLabel)
  .pipe(z.string().min(1))

export const wrongNoteQuestionPreviewSchema = nonBlankTextSchema.refine(
  (value) => [...value].length <= 160,
  '문제 미리보기는 Unicode code point 기준 160자 이하여야 합니다.'
)

export const compareWrongNoteTagLabels = (
  left: string,
  right: string
): number => {
  const trimmedLeft = trimWrongNoteTagLabel(left)
  const trimmedRight = trimWrongNoteTagLabel(right)

  if (trimmedLeft === trimmedRight) {
    return 0
  }

  return trimmedLeft < trimmedRight ? -1 : 1
}

export const createSortedUniqueWrongNoteTagLabelsSchema = (minimum: number) =>
  z
    .array(wrongNoteTagLabelSchema)
    .min(minimum)
    .superRefine((labels, context) => {
      const exactLabels = new Set<string>()

      labels.forEach((label, index) => {
        const trimmed = trimWrongNoteTagLabel(label)
        const previous = labels[index - 1]

        if (
          previous !== undefined &&
          compareWrongNoteTagLabels(previous, label) > 0
        ) {
          context.addIssue({
            code: 'custom',
            path: [index],
            message:
              '태그 label은 trim된 exact 문자열 순서로 정렬되어야 합니다.'
          })
        }

        if (exactLabels.has(trimmed)) {
          context.addIssue({
            code: 'custom',
            path: [index],
            message: '태그 label은 trim 후 서로 달라야 합니다.'
          })
        }

        exactLabels.add(trimmed)
      })
    })

export const wrongNoteSummarySchema = z
  .object({
    questionId: opaqueIdSchema,
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    questionType: questionTypeSchema,
    questionPreview: wrongNoteQuestionPreviewSchema,
    wrongCount: z.number().int().positive(),
    correctStreak: z.number().int().nonnegative(),
    status: wrongNoteStatusSchema,
    lastWrongAt: isoDateTimeSchema,
    lastReviewedAt: isoDateTimeSchema.nullable(),
    nextReviewAt: isoDateTimeSchema,
    tags: createSortedUniqueWrongNoteTagLabelsSchema(1),
    hasMemo: z.literal(false),
    reviewAvailability: reviewAvailabilitySchema
  })
  .strict()
  .superRefine((note, context) => {
    const validState =
      (note.status === 'NEW' &&
        note.wrongCount === 1 &&
        note.correctStreak === 0 &&
        note.lastReviewedAt === null) ||
      (note.status === 'AGAIN' &&
        note.wrongCount >= 2 &&
        note.correctStreak === 0 &&
        note.lastReviewedAt !== null) ||
      (note.status === 'REVIEWING' &&
        note.correctStreak === 1 &&
        note.lastReviewedAt !== null) ||
      (note.status === 'SOLVED' &&
        note.correctStreak >= 2 &&
        note.lastReviewedAt !== null)

    if (!validState) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: '오답 노트 상태와 count·review 시각이 일치해야 합니다.'
      })
    }

    if (
      note.lastReviewedAt !== null &&
      note.lastReviewedAt < note.lastWrongAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lastReviewedAt'],
        message: '마지막 review 시각은 마지막 오답 시각보다 빠를 수 없습니다.'
      })
    }
  })

export const listWrongNotesOperationId = 'wrongNote.listWrongNotes' as const

export const listWrongNotesQuerySchema = pageRequestSchema
  .extend({
    level: jlptLevelSchema.optional(),
    subject: questionSubjectSchema.optional(),
    status: wrongNoteStatusSchema.optional(),
    tag: wrongNoteTagLabelSchema.optional(),
    sort: wrongNoteSortSchema.default('RECENT')
  })
  .strict()

export const listWrongNotesResponseSchema = createPageResponseSchema(
  wrongNoteSummarySchema
)
  .extend({
    availableTags: createSortedUniqueWrongNoteTagLabelsSchema(0)
  })
  .strict()
  .superRefine((page, context) => {
    if (page.items.length > page.pageSize || page.items.length > page.total) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: '오답 노트 page count가 pagination metadata와 일치해야 합니다.'
      })
    }
  })

export const listWrongNotesErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const listWrongNotesErrorSchema = createApiFailureSchema(
  listWrongNotesErrorCodeSchema
)

export type ListWrongNotesQuery = z.input<typeof listWrongNotesQuerySchema>
export type ParsedListWrongNotesQuery = z.output<
  typeof listWrongNotesQuerySchema
>
export type WrongNoteSummary = z.output<typeof wrongNoteSummarySchema>
export type ListWrongNotesResponse = z.output<
  typeof listWrongNotesResponseSchema
>
export type ListWrongNotesError = z.output<typeof listWrongNotesErrorSchema>

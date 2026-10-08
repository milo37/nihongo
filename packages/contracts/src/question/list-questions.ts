import { z } from 'zod'
import {
  jlptLevelSchema,
  questionDifficultySchema,
  questionSubjectSchema,
  questionTypeSchema
} from '../common/enum.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  createPageResponseSchema,
  pageRequestSchema
} from '../common/pagination.js'
import {
  comparePublicQuestionTags,
  normalizeQuestionTagText,
  publicQuestionTagSchema
} from './get-question.js'

const nonBlankTextSchema = z.string().trim().min(1)

export const listQuestionsOperationId = 'question.listQuestions' as const

export const listQuestionsQuerySchema = pageRequestSchema
  .extend({
    level: jlptLevelSchema.optional(),
    subject: questionSubjectSchema.optional(),
    type: questionTypeSchema.optional(),
    difficulty: questionDifficultySchema.optional(),
    tag: nonBlankTextSchema.transform(normalizeQuestionTagText).optional()
  })
  .strict()

export const publicQuestionSummarySchema = z
  .object({
    id: opaqueIdSchema,
    questionVersionId: opaqueIdSchema,
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    questionType: questionTypeSchema,
    difficulty: questionDifficultySchema,
    questionTextPreview: nonBlankTextSchema.max(160),
    tags: z.array(publicQuestionTagSchema).min(1)
  })
  .strict()
  .superRefine((question, context) => {
    const tagIds = new Set<string>()
    const normalizedTagLabels = new Set<string>()

    question.tags.forEach((tag, index) => {
      const normalizedLabel = normalizeQuestionTagText(tag.label)
      const previousTag = question.tags[index - 1]

      if (previousTag && comparePublicQuestionTags(previousTag, tag) > 0) {
        context.addIssue({
          code: 'custom',
          path: ['tags', index],
          message: '태그는 label과 ID 순서로 정렬되어야 합니다.'
        })
      }

      if (tagIds.has(tag.id) || normalizedTagLabels.has(normalizedLabel)) {
        context.addIssue({
          code: 'custom',
          path: ['tags', index],
          message: '태그 ID와 label은 문제 안에서 서로 달라야 합니다.'
        })
      }

      tagIds.add(tag.id)
      normalizedTagLabels.add(normalizedLabel)
    })
  })

export const listQuestionsResponseSchema = createPageResponseSchema(
  publicQuestionSummarySchema
)

export const listQuestionsErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const listQuestionsErrorSchema = createApiFailureSchema(
  listQuestionsErrorCodeSchema
)

export type ListQuestionsQuery = z.input<typeof listQuestionsQuerySchema>
export type ParsedListQuestionsQuery = z.output<typeof listQuestionsQuerySchema>
export type PublicQuestionSummary = z.output<typeof publicQuestionSummarySchema>
export type ListQuestionsResponse = z.output<typeof listQuestionsResponseSchema>
export type ListQuestionsError = z.output<typeof listQuestionsErrorSchema>

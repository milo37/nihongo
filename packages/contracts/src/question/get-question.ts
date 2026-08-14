import { z } from 'zod'
import {
  jlptLevelSchema,
  questionDifficultySchema,
  questionSubjectSchema,
  questionTypeSchema
} from '../common/enum.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'

const nonBlankTextSchema = z.string().trim().min(1)
const INTERNAL_WHITESPACE_PATTERN = /\s+/gu

export const normalizeQuestionTagText = (value: string): string =>
  value
    .normalize('NFKC')
    .trim()
    .replace(INTERNAL_WHITESPACE_PATTERN, ' ')
    .toLocaleLowerCase()

export const comparePublicQuestionTags = (
  left: { readonly id: string; readonly label: string },
  right: { readonly id: string; readonly label: string }
): number => {
  if (left.label !== right.label) {
    return left.label < right.label ? -1 : 1
  }

  if (left.id === right.id) {
    return 0
  }

  return left.id < right.id ? -1 : 1
}

export const getQuestionOperationId = 'question.getQuestion' as const

export const getQuestionParamsSchema = z
  .object({
    questionId: opaqueIdSchema
  })
  .strict()

export const publicQuestionOptionSchema = z
  .object({
    id: opaqueIdSchema,
    label: z.enum(['1', '2', '3', '4']),
    text: nonBlankTextSchema
  })
  .strict()

export const publicQuestionTagSchema = z
  .object({
    id: opaqueIdSchema,
    label: nonBlankTextSchema
  })
  .strict()

export const publicPracticeQuestionSchema = z
  .object({
    id: opaqueIdSchema,
    questionVersionId: opaqueIdSchema,
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    questionType: questionTypeSchema,
    passage: nonBlankTextSchema.nullable(),
    questionText: nonBlankTextSchema,
    options: z.array(publicQuestionOptionSchema).length(4),
    difficulty: questionDifficultySchema,
    tags: z.array(publicQuestionTagSchema).min(1)
  })
  .strict()
  .superRefine((question, context) => {
    if (
      question.subject === 'READING' &&
      (question.passage === null || question.passage.trim().length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['passage'],
        message: '독해 문제에는 지문이 필요합니다.'
      })
    }

    const optionIds = new Set<string>()

    question.options.forEach((option, index) => {
      if (option.label !== String(index + 1)) {
        context.addIssue({
          code: 'custom',
          path: ['options', index, 'label'],
          message: '보기 label은 1부터 4까지 순서대로 제공해야 합니다.'
        })
      }

      if (optionIds.has(option.id)) {
        context.addIssue({
          code: 'custom',
          path: ['options', index, 'id'],
          message: '보기 ID는 서로 달라야 합니다.'
        })
      }

      optionIds.add(option.id)
    })

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

export const getQuestionResponseSchema = publicPracticeQuestionSchema

export const getQuestionErrorCodeSchema = z.enum([
  'INVALID_ID',
  'RESOURCE_NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const getQuestionErrorSchema = createApiFailureSchema(
  getQuestionErrorCodeSchema
)

export type GetQuestionParams = z.input<typeof getQuestionParamsSchema>
export type GetQuestionResponse = z.output<typeof getQuestionResponseSchema>
export type GetQuestionError = z.output<typeof getQuestionErrorSchema>

import { z } from 'zod'
import {
  jlptLevelSchema,
  questionDifficultySchema,
  questionSubjectSchema,
  questionTypeSchema
} from '../common/enum.js'
import { opaqueIdSchema } from '../common/id.js'
import {
  comparePublicQuestionTags,
  normalizeQuestionTagText,
  publicQuestionTagSchema
} from './get-question.js'

const nonBlankTextSchema = z.string().trim().min(1)

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

export type PublicQuestionSummary = z.output<typeof publicQuestionSummarySchema>

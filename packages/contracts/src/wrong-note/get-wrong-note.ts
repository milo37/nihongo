import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { reviewedQuestionSchema } from '../study/study-result.js'
import {
  compareWrongNoteTagLabels,
  wrongNoteSummarySchema,
  wrongNoteTagLabelSchema
} from './list-wrong-notes.js'

export const historicalWrongNoteQuestionTagSchema = z
  .object({
    id: opaqueIdSchema,
    label: wrongNoteTagLabelSchema
  })
  .strict()

export const historicalReviewedQuestionSchema = z
  .object({
    id: reviewedQuestionSchema.shape.id,
    questionVersionId: reviewedQuestionSchema.shape.questionVersionId,
    level: reviewedQuestionSchema.shape.level,
    subject: reviewedQuestionSchema.shape.subject,
    questionType: reviewedQuestionSchema.shape.questionType,
    passage: reviewedQuestionSchema.shape.passage,
    questionText: reviewedQuestionSchema.shape.questionText,
    options: reviewedQuestionSchema.shape.options,
    difficulty: reviewedQuestionSchema.shape.difficulty,
    tags: z.array(historicalWrongNoteQuestionTagSchema).min(1),
    correctOptionId: reviewedQuestionSchema.shape.correctOptionId,
    explanationKo: reviewedQuestionSchema.shape.explanationKo,
    explanationJa: reviewedQuestionSchema.shape.explanationJa
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
    const tagLabels = new Set<string>()
    question.tags.forEach((tag, index) => {
      const previous = question.tags[index - 1]
      if (
        previous &&
        (compareWrongNoteTagLabels(previous.label, tag.label) > 0 ||
          (previous.label === tag.label && previous.id > tag.id))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['tags', index],
          message: 'historical tag는 exact label과 ID 순서여야 합니다.'
        })
      }
      if (tagIds.has(tag.id) || tagLabels.has(tag.label)) {
        context.addIssue({
          code: 'custom',
          path: ['tags', index],
          message: 'historical tag ID와 exact label은 서로 달라야 합니다.'
        })
      }
      tagIds.add(tag.id)
      tagLabels.add(tag.label)
    })

    if (!optionIds.has(question.correctOptionId)) {
      context.addIssue({
        code: 'custom',
        path: ['correctOptionId'],
        message: '정답 보기는 이 문제 version에 속해야 합니다.'
      })
    }
  })

export const getWrongNoteOperationId = 'wrongNote.getWrongNote' as const

export const getWrongNoteParamsSchema = z
  .object({ questionId: opaqueIdSchema })
  .strict()

export const getWrongNoteQuerySchema = z.object({}).strict()

export const getWrongNoteResponseSchema = z
  .object({
    wrongNote: wrongNoteSummarySchema,
    question: historicalReviewedQuestionSchema,
    memo: z.null(),
    lastWrongQuestionVersionId: opaqueIdSchema,
    currentReviewQuestionVersionId: z.null()
  })
  .strict()
  .superRefine((detail, context) => {
    if (detail.wrongNote.questionId !== detail.question.id) {
      context.addIssue({
        code: 'custom',
        path: ['question', 'id'],
        message: 'ReviewedQuestion은 owned WrongNote의 문제여야 합니다.'
      })
    }

    if (
      detail.lastWrongQuestionVersionId !== detail.question.questionVersionId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lastWrongQuestionVersionId'],
        message: '상세 문제는 마지막 오답 version이어야 합니다.'
      })
    }

    const questionLabels = [
      ...new Set(detail.question.tags.map(({ label }) => label))
    ].toSorted(compareWrongNoteTagLabels)
    if (
      questionLabels.length !== detail.wrongNote.tags.length ||
      questionLabels.some(
        (label, index) => label !== detail.wrongNote.tags[index]
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['question', 'tags'],
        message: '상세 문제와 요약은 동일한 historical tag label이어야 합니다.'
      })
    }
  })

export const getWrongNoteErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'INVALID_ID',
  'RESOURCE_NOT_FOUND',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const getWrongNoteErrorSchema = createApiFailureSchema(
  getWrongNoteErrorCodeSchema
)

export type GetWrongNoteParams = z.input<typeof getWrongNoteParamsSchema>
export type GetWrongNoteQuery = z.input<typeof getWrongNoteQuerySchema>
export type GetWrongNoteResponse = z.output<typeof getWrongNoteResponseSchema>
export type GetWrongNoteError = z.output<typeof getWrongNoteErrorSchema>

import { z } from 'zod'
import { isoDateTimeSchema } from '../common/date.js'
import {
  jlptLevelSchema,
  questionSubjectSchema,
  studyModeSchema,
  wrongNoteStatusSchema
} from '../common/enum.js'
import { opaqueIdSchema } from '../common/id.js'
import { publicPracticeQuestionSchema } from '../question/get-question.js'

const nonBlankTextSchema = z.string().trim().min(1)

export const reviewedQuestionSchema = publicPracticeQuestionSchema
  .safeExtend({
    correctOptionId: opaqueIdSchema,
    explanationKo: nonBlankTextSchema,
    explanationJa: nonBlankTextSchema.nullable()
  })
  .superRefine((question, context) => {
    if (
      !question.options.some((option) => option.id === question.correctOptionId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['correctOptionId'],
        message: '정답 보기는 이 문제 version에 속해야 합니다.'
      })
    }
  })

export const studyResultItemSchema = z
  .object({
    sessionQuestionId: opaqueIdSchema,
    question: reviewedQuestionSchema,
    selectedOptionId: opaqueIdSchema.nullable(),
    isCorrect: z.boolean(),
    wrongNoteStatus: wrongNoteStatusSchema.nullable()
  })
  .strict()
  .superRefine((item, context) => {
    const optionIds = new Set(item.question.options.map((option) => option.id))

    if (
      item.selectedOptionId !== null &&
      !optionIds.has(item.selectedOptionId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['selectedOptionId'],
        message: '선택한 보기는 이 문제 version에 속해야 합니다.'
      })
    }

    const expectedCorrect =
      item.selectedOptionId !== null &&
      item.selectedOptionId === item.question.correctOptionId

    if (item.isCorrect !== expectedCorrect) {
      context.addIssue({
        code: 'custom',
        path: ['isCorrect'],
        message: '채점 결과는 고정된 정답 보기와 일치해야 합니다.'
      })
    }

    if (
      item.wrongNoteStatus !== null &&
      ((item.isCorrect &&
        !['REVIEWING', 'SOLVED'].includes(item.wrongNoteStatus)) ||
        (!item.isCorrect && !['NEW', 'AGAIN'].includes(item.wrongNoteStatus)))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['wrongNoteStatus'],
        message: '오답 노트 상태는 채점 결과와 일치해야 합니다.'
      })
    }
  })

export const studyResultSchema = z
  .object({
    sessionId: opaqueIdSchema,
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    mode: studyModeSchema,
    totalCount: z.number().int().min(1).max(20),
    correctCount: z.number().int().nonnegative().max(20),
    incorrectCount: z.number().int().nonnegative().max(20),
    correctRate: z.number().min(0).max(100),
    durationSec: z.number().int().min(0).max(604_800),
    submittedAt: isoDateTimeSchema,
    items: z.array(studyResultItemSchema).min(1).max(20)
  })
  .strict()
  .superRefine((result, context) => {
    const itemCorrectCount = result.items.filter(
      (item) => item.isCorrect
    ).length
    const expectedCorrectRate =
      Math.round((result.correctCount * 10_000) / result.totalCount) / 100

    if (
      result.items.length !== result.totalCount ||
      result.correctCount + result.incorrectCount !== result.totalCount ||
      itemCorrectCount !== result.correctCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['totalCount'],
        message: '결과 count는 item 채점 집계와 일치해야 합니다.'
      })
    }

    if (result.correctRate !== expectedCorrectRate) {
      context.addIssue({
        code: 'custom',
        path: ['correctRate'],
        message: '정답률은 basis points 반올림 결과와 일치해야 합니다.'
      })
    }

    const sessionQuestionIds = new Set<string>()
    const questionIds = new Set<string>()
    const versionIds = new Set<string>()

    result.items.forEach((item, index) => {
      if (
        sessionQuestionIds.has(item.sessionQuestionId) ||
        questionIds.has(item.question.id) ||
        versionIds.has(item.question.questionVersionId)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index],
          message: '결과 item은 고유한 세션 문제와 고정 version이어야 합니다.'
        })
      }

      if (
        item.question.level !== result.level ||
        item.question.subject !== result.subject
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'question'],
          message: '결과 조건과 문제 조건이 일치해야 합니다.'
        })
      }

      sessionQuestionIds.add(item.sessionQuestionId)
      questionIds.add(item.question.id)
      versionIds.add(item.question.questionVersionId)
    })
  })

export type ReviewedQuestion = z.output<typeof reviewedQuestionSchema>
export type StudyResultItem = z.output<typeof studyResultItemSchema>
export type StudyResult = z.output<typeof studyResultSchema>

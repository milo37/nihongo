import { z } from 'zod'
import { normalizeQuestionTagText } from '@nihongo/contracts/question/get-question'

export const jlptLevelSchema = z.enum(['N5', 'N4', 'N3', 'N2', 'N1'])
export const questionSubjectSchema = z.enum([
  'VOCABULARY',
  'GRAMMAR',
  'READING'
])
export const questionTypeSchema = z.enum([
  'KANJI_READING',
  'ORTHOGRAPHY',
  'CONTEXT_VOCABULARY',
  'PARAPHRASE',
  'WORD_USAGE',
  'GRAMMAR_SELECT',
  'SENTENCE_ORDER',
  'TEXT_GRAMMAR',
  'SHORT_READING',
  'MEDIUM_READING',
  'LONG_READING',
  'INFO_RETRIEVAL'
])
export const questionDifficultySchema = z.enum(['EASY', 'NORMAL', 'HARD'])
export const questionStatusSchema = z.enum(['DRAFT', 'PUBLISHED'])
export const studyModeSchema = z.enum([
  'RANDOM',
  'WRONG_NOTE',
  'WEAKNESS',
  'BOOKMARK',
  'DAILY_REVIEW'
])
export const studySessionStatusSchema = z.enum(['IN_PROGRESS', 'SUBMITTED'])
export const wrongNoteStatusSchema = z.enum([
  'NEW',
  'REVIEWING',
  'AGAIN',
  'SOLVED'
])
export const userRoleSchema = z.enum(['GUEST', 'USER', 'ADMIN'])
export const isoDateTimeSchema = z.string().datetime()

export const userSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    role: userRoleSchema,
    targetLevel: jlptLevelSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict()

export const questionOptionRecordSchema = z
  .object({
    id: z.string().min(1),
    label: z.enum(['1', '2', '3', '4']),
    text: z.string().min(1),
    isCorrect: z.boolean()
  })
  .strict()

export const practiceQuestionOptionSchema = questionOptionRecordSchema
  .omit({ isCorrect: true })
  .strict()

export const questionRecordSchema = z
  .object({
    id: z.string().min(1),
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    questionType: questionTypeSchema,
    passage: z.string().min(1).nullable(),
    questionText: z.string().min(1),
    options: z.array(questionOptionRecordSchema).length(4),
    explanationKo: z.string().min(1),
    explanationJa: z.string().min(1).nullable(),
    difficulty: questionDifficultySchema,
    tags: z.array(z.string().min(1)).min(1),
    status: questionStatusSchema,
    sourceType: z.literal('ORIGINAL'),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict()

export const practiceQuestionSchema = z
  .object({
    id: z.string().min(1),
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    questionType: questionTypeSchema,
    passage: z.string().min(1).nullable(),
    questionText: z.string().min(1),
    options: z.array(practiceQuestionOptionSchema).length(4),
    difficulty: questionDifficultySchema,
    tags: z.array(z.string().min(1)).min(1)
  })
  .strict()

export const studySessionSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1).nullable(),
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    mode: studyModeSchema,
    questionIds: z.array(z.string().min(1)).min(1),
    status: studySessionStatusSchema,
    startedAt: isoDateTimeSchema,
    submittedAt: isoDateTimeSchema.nullable(),
    durationSec: z.number().int().nonnegative().nullable()
  })
  .strict()

export const studyAnswerInputSchema = z
  .object({
    questionId: z.string().min(1),
    selectedOptionId: z.string().min(1),
    elapsedSec: z.number().int().nonnegative()
  })
  .strict()

export const studyResultItemSchema = z
  .object({
    question: practiceQuestionSchema,
    selectedOptionId: z.string().min(1).nullable(),
    correctOptionId: z.string().min(1),
    isCorrect: z.boolean(),
    explanationKo: z.string().min(1),
    explanationJa: z.string().min(1).nullable(),
    tags: z.array(z.string().min(1)).min(1)
  })
  .strict()

export const studyResultSchema = z
  .object({
    sessionId: z.string().min(1),
    totalCount: z.number().int().nonnegative(),
    correctCount: z.number().int().nonnegative(),
    incorrectCount: z.number().int().nonnegative(),
    correctRate: z.number().min(0).max(100),
    durationSec: z.number().int().nonnegative(),
    items: z.array(studyResultItemSchema)
  })
  .strict()

export const wrongNoteSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    questionId: z.string().min(1),
    wrongCount: z.number().int().positive(),
    correctStreak: z.number().int().nonnegative(),
    status: wrongNoteStatusSchema,
    memo: z.string().nullable(),
    lastWrongAt: isoDateTimeSchema,
    lastReviewedAt: isoDateTimeSchema.nullable(),
    nextReviewAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict()

export const bookmarkSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    questionId: z.string().min(1),
    createdAt: isoDateTimeSchema
  })
  .strict()

export const subjectStatSchema = z
  .object({
    subject: questionSubjectSchema,
    answeredCount: z.number().int().nonnegative(),
    correctCount: z.number().int().nonnegative(),
    correctRate: z.number().min(0).max(100)
  })
  .strict()

export const recentStudySessionSchema = z
  .object({
    id: z.string().min(1),
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    mode: studyModeSchema,
    totalCount: z.number().int().nonnegative(),
    correctCount: z.number().int().nonnegative(),
    correctRate: z.number().min(0).max(100),
    durationSec: z.number().int().nonnegative(),
    submittedAt: isoDateTimeSchema
  })
  .strict()

export const dailyStudyCountSchema = z
  .object({
    date: z.string().date(),
    count: z.number().int().nonnegative()
  })
  .strict()

export const repeatedWrongQuestionSchema = z
  .object({
    questionId: z.string().min(1),
    questionText: z.string().min(1),
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    wrongCount: z.number().int().positive()
  })
  .strict()

export const dashboardStatsSchema = z
  .object({
    totalAnsweredCount: z.number().int().nonnegative(),
    correctCount: z.number().int().nonnegative(),
    correctRate: z.number().min(0).max(100),
    wrongNoteCount: z.number().int().nonnegative(),
    solvedWrongNoteCount: z.number().int().nonnegative(),
    weakestSubject: questionSubjectSchema.nullable(),
    subjectStats: z.array(subjectStatSchema),
    recentStudySessions: z.array(recentStudySessionSchema),
    dailyStudyCountLast7Days: z.array(dailyStudyCountSchema).max(7),
    repeatedWrongQuestions: z.array(repeatedWrongQuestionSchema)
  })
  .strict()

export const adminQuestionSummarySchema = questionRecordSchema
  .pick({
    id: true,
    level: true,
    subject: true,
    questionType: true,
    questionText: true,
    difficulty: true,
    tags: true,
    status: true,
    updatedAt: true
  })
  .strict()

export const questionEditorInputSchema = z
  .object({
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    questionType: questionTypeSchema,
    passage: z.string().trim().min(1).nullable(),
    questionText: z.string().trim().min(1),
    options: z
      .array(
        z
          .object({
            id: z.string().min(1).optional(),
            label: z.enum(['1', '2', '3', '4']),
            text: z.string().trim().min(1)
          })
          .strict()
      )
      .length(4),
    correctOptionId: z.string().min(1),
    explanationKo: z.string().trim().min(1),
    explanationJa: z.string().trim().min(1).nullable(),
    difficulty: questionDifficultySchema,
    tags: z.array(z.string().trim().min(1)).min(1),
    status: questionStatusSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.subject === 'READING' && value.passage === null) {
      context.addIssue({
        code: 'custom',
        path: ['passage'],
        message: '독해 문제는 지문이 필요합니다.'
      })
    }

    const normalizedOptions = value.options.map((option) => option.text.trim())

    if (new Set(normalizedOptions).size !== normalizedOptions.length) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: '동일한 보기를 중복해서 입력할 수 없습니다.'
      })
    }

    const normalizedTags = value.tags.map(normalizeQuestionTagText)

    if (new Set(normalizedTags).size !== normalizedTags.length) {
      context.addIssue({
        code: 'custom',
        path: ['tags'],
        message: '정규화했을 때 같은 태그를 중복해서 입력할 수 없습니다.'
      })
    }

    const matchingCorrectOptions = value.options.filter(
      (option) =>
        option.id === value.correctOptionId ||
        option.label === value.correctOptionId
    )

    if (matchingCorrectOptions.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['correctOptionId'],
        message: '정답은 보기 중 정확히 하나를 선택해야 합니다.'
      })
    }
  })

export const successResponseSchema = z
  .object({
    success: z.literal(true)
  })
  .strict()

export const idParamsSchema = z
  .object({
    id: z.string().min(1)
  })
  .strict()

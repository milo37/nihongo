import { z } from 'zod'
import { calendarDateSchema, isoDateTimeSchema } from '../common/date.js'
import {
  jlptLevelSchema,
  questionSubjectSchema,
  studyModeSchema,
  wrongNoteStatusSchema
} from '../common/enum.js'
import { createApiFailureSchema } from '../common/error.js'
import { opaqueIdSchema } from '../common/id.js'
import { wrongNoteQuestionPreviewSchema } from '../wrong-note/list-wrong-notes.js'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000
const SUBJECTS = ['VOCABULARY', 'GRAMMAR', 'READING'] as const
const safeCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
const correctRateSchema = z
  .number()
  .finite()
  .min(0)
  .max(100)
  .refine(
    (value) => Math.round(value * 100) / 100 === value,
    '정답률은 basis points 단위여야 합니다.'
  )

const calculateCorrectRate = (
  correctCount: number,
  answeredCount: number
): number => {
  if (answeredCount === 0) {
    return 0
  }

  const correct = BigInt(correctCount)
  const answered = BigInt(answeredCount)
  const basisPoints = (correct * 10_000n + answered / 2n) / answered

  return Number(basisPoints) / 100
}

const parseCalendarDate = (value: string): Date =>
  new Date(`${value}T00:00:00.000Z`)

const formatCalendarDate = (value: Date): string =>
  value.toISOString().slice(0, 10)

export const getDashboardStatsOperationId =
  'dashboard.getDashboardStats' as const

export const getDashboardStatsQuerySchema = z
  .object({
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional()
  })
  .strict()
  .superRefine((range, context) => {
    if ((range.from === undefined) !== (range.to === undefined)) {
      context.addIssue({
        code: 'custom',
        path: [range.from === undefined ? 'from' : 'to'],
        message: 'from과 to는 함께 제공해야 합니다.'
      })
      return
    }

    if (range.from === undefined || range.to === undefined) {
      return
    }

    const fromTime = parseCalendarDate(range.from).getTime()
    const toTime = parseCalendarDate(range.to).getTime()

    if (fromTime > toTime) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'to는 from보다 빠를 수 없습니다.'
      })
      return
    }

    const inclusiveDays = (toTime - fromTime) / DAY_MILLISECONDS + 1
    if (inclusiveDays > 366) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: '대시보드 조회 범위는 최대 366일입니다.'
      })
    }
  })

export const dashboardSubjectStatSchema = z
  .object({
    subject: questionSubjectSchema,
    answeredCount: safeCountSchema,
    correctCount: safeCountSchema,
    correctRate: correctRateSchema
  })
  .strict()
  .superRefine((stat, context) => {
    if (
      stat.correctCount > stat.answeredCount ||
      stat.correctRate !==
        calculateCorrectRate(stat.correctCount, stat.answeredCount)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['correctRate'],
        message: '과목 정답률은 count의 basis points 반올림과 일치해야 합니다.'
      })
    }
  })

export const dashboardRecentStudySessionSchema = z
  .object({
    id: opaqueIdSchema,
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    mode: studyModeSchema,
    totalCount: safeCountSchema.min(1).max(20),
    correctCount: safeCountSchema.max(20),
    correctRate: correctRateSchema,
    durationSec: safeCountSchema.max(604_800),
    submittedAt: isoDateTimeSchema
  })
  .strict()
  .superRefine((session, context) => {
    if (
      session.correctCount > session.totalCount ||
      session.correctRate !==
        calculateCorrectRate(session.correctCount, session.totalCount)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['correctRate'],
        message:
          '최근 세션 정답률은 count의 basis points 반올림과 일치해야 합니다.'
      })
    }
  })

export const dashboardDailyStudyCountSchema = z
  .object({
    date: calendarDateSchema,
    count: safeCountSchema
  })
  .strict()

export const dashboardRepeatedWrongQuestionSchema = z
  .object({
    questionId: opaqueIdSchema,
    questionPreview: wrongNoteQuestionPreviewSchema,
    level: jlptLevelSchema,
    subject: questionSubjectSchema,
    wrongCount: safeCountSchema.min(1),
    status: wrongNoteStatusSchema
  })
  .strict()

export const getDashboardStatsResponseSchema = z
  .object({
    totalAnsweredCount: safeCountSchema,
    correctCount: safeCountSchema,
    correctRate: correctRateSchema,
    wrongNoteCount: safeCountSchema,
    solvedWrongNoteCount: safeCountSchema,
    weakestSubject: questionSubjectSchema.nullable(),
    subjectStats: z.array(dashboardSubjectStatSchema).length(3),
    recentStudySessions: z.array(dashboardRecentStudySessionSchema).max(5),
    dailyStudyCountLast7Days: z.array(dashboardDailyStudyCountSchema).length(7),
    repeatedWrongQuestions: z.array(dashboardRepeatedWrongQuestionSchema).max(5)
  })
  .strict()
  .superRefine((dashboard, context) => {
    dashboard.subjectStats.forEach((stat, index) => {
      if (stat.subject !== SUBJECTS[index]) {
        context.addIssue({
          code: 'custom',
          path: ['subjectStats', index, 'subject'],
          message: '과목 통계는 고정된 subject 순서여야 합니다.'
        })
      }
    })

    const answeredCount = dashboard.subjectStats.reduce(
      (total, stat) => total + BigInt(stat.answeredCount),
      0n
    )
    const correctCount = dashboard.subjectStats.reduce(
      (total, stat) => total + BigInt(stat.correctCount),
      0n
    )
    if (
      answeredCount !== BigInt(dashboard.totalAnsweredCount) ||
      correctCount !== BigInt(dashboard.correctCount) ||
      dashboard.correctCount > dashboard.totalAnsweredCount ||
      dashboard.correctRate !==
        calculateCorrectRate(
          dashboard.correctCount,
          dashboard.totalAnsweredCount
        )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['correctRate'],
        message: '전체 count와 정답률은 과목 집계와 일치해야 합니다.'
      })
    }

    const weakestSubject = dashboard.subjectStats.reduce<
      (typeof SUBJECTS)[number] | null
    >((weakest, stat) => {
      if (stat.answeredCount < 3) {
        return weakest
      }
      if (weakest === null) {
        return stat.subject
      }
      const weakestStat = dashboard.subjectStats.find(
        (candidate) => candidate.subject === weakest
      )
      return weakestStat && stat.correctRate < weakestStat.correctRate
        ? stat.subject
        : weakest
    }, null)

    if (dashboard.weakestSubject !== weakestSubject) {
      context.addIssue({
        code: 'custom',
        path: ['weakestSubject'],
        message:
          '취약 과목은 최소 3문항과 고정 subject tie-break를 따라야 합니다.'
      })
    }

    dashboard.recentStudySessions.forEach((session, index) => {
      const previous = dashboard.recentStudySessions[index - 1]
      if (
        previous &&
        (previous.submittedAt < session.submittedAt ||
          (previous.submittedAt === session.submittedAt &&
            previous.id > session.id))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['recentStudySessions', index],
          message: '최근 세션은 제출 시각 내림차순과 ID 오름차순이어야 합니다.'
        })
      }
    })

    dashboard.dailyStudyCountLast7Days.forEach((daily, index) => {
      const previous = dashboard.dailyStudyCountLast7Days[index - 1]
      if (previous) {
        const expected = parseCalendarDate(previous.date)
        expected.setUTCDate(expected.getUTCDate() + 1)
        if (daily.date !== formatCalendarDate(expected)) {
          context.addIssue({
            code: 'custom',
            path: ['dailyStudyCountLast7Days', index, 'date'],
            message: '일별 통계는 7개의 연속된 UTC 날짜여야 합니다.'
          })
        }
      }
    })

    dashboard.repeatedWrongQuestions.forEach((question, index) => {
      const previous = dashboard.repeatedWrongQuestions[index - 1]
      if (previous && previous.wrongCount < question.wrongCount) {
        context.addIssue({
          code: 'custom',
          path: ['repeatedWrongQuestions', index, 'wrongCount'],
          message: '반복 오답은 오답 횟수 내림차순이어야 합니다.'
        })
      }
    })

    if (
      dashboard.solvedWrongNoteCount > dashboard.wrongNoteCount ||
      dashboard.repeatedWrongQuestions.length > dashboard.wrongNoteCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['wrongNoteCount'],
        message: '오답 노트 집계와 부분 집합 count가 일치해야 합니다.'
      })
    }
  })

export const getDashboardStatsErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const getDashboardStatsErrorSchema = createApiFailureSchema(
  getDashboardStatsErrorCodeSchema
)

export type GetDashboardStatsQuery = z.input<
  typeof getDashboardStatsQuerySchema
>
export type ParsedGetDashboardStatsQuery = z.output<
  typeof getDashboardStatsQuerySchema
>
export type DashboardSubjectStat = z.output<typeof dashboardSubjectStatSchema>
export type DashboardRecentStudySession = z.output<
  typeof dashboardRecentStudySessionSchema
>
export type DashboardDailyStudyCount = z.output<
  typeof dashboardDailyStudyCountSchema
>
export type DashboardRepeatedWrongQuestion = z.output<
  typeof dashboardRepeatedWrongQuestionSchema
>
export type GetDashboardStatsResponse = z.output<
  typeof getDashboardStatsResponseSchema
>
export type GetDashboardStatsError = z.output<
  typeof getDashboardStatsErrorSchema
>

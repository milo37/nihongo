import { z } from 'zod'
import { calendarDateSchema, isoDateTimeSchema } from '../common/date.js'
import { createApiFailureSchema } from '../common/error.js'
import { resumableStudySessionSummarySchema } from '../study/list-resumable-study-sessions.js'

/**
 * Learner home "my today" card (#773). Days follow Korea time; a day counts
 * as studied when the member submitted at least one study session that day.
 */
export const getMyTodayOperationId = 'dashboard.getMyToday' as const

export const MY_TODAY_TIME_ZONE = 'Asia/Seoul' as const
export const MY_TODAY_DAILY_GOAL = 10 as const

/** The card takes no query parameters; anything sent is rejected. */
export const getMyTodayQuerySchema = z.object({}).strict()

const safeCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

export const getMyTodayResponseSchema = z
  .object({
    observedAt: isoDateTimeSchema,
    timeZone: z.literal(MY_TODAY_TIME_ZONE),
    today: calendarDateSchema,
    /** Consecutive studied days ending today, or yesterday when today has none yet. 0 once broken. */
    streakDays: safeCountSchema,
    studiedToday: z.boolean(),
    /** Questions in study sessions submitted today; keeps counting past the goal. */
    todayAnsweredCount: safeCountSchema,
    dailyGoal: z.literal(MY_TODAY_DAILY_GOAL),
    /** Same number as the review queue `counts.due`. */
    reviewDueCount: safeCountSchema,
    latestResumableSession: resumableStudySessionSummarySchema.nullable()
  })
  .strict()
  .superRefine((today, context) => {
    if (today.studiedToday && today.streakDays === 0) {
      context.addIssue({
        code: 'custom',
        path: ['streakDays'],
        message: '오늘 학습했다면 연속 학습일은 1 이상이어야 합니다.'
      })
    }
    if (today.studiedToday !== today.todayAnsweredCount > 0) {
      context.addIssue({
        code: 'custom',
        path: ['studiedToday'],
        message: '오늘 학습 여부는 오늘 푼 문제 수와 일치해야 합니다.'
      })
    }
  })

const getMyTodayErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const getMyTodayErrorSchema = createApiFailureSchema(
  getMyTodayErrorCodeSchema
)

export type GetMyTodayResponse = z.output<typeof getMyTodayResponseSchema>
export type GetMyTodayError = z.output<typeof getMyTodayErrorSchema>

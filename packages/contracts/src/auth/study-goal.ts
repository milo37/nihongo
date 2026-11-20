import { z } from 'zod'
import { createApiFailureSchema } from '../common/error.js'
import { jlptLevelSchema } from '../common/enum.js'

/**
 * #1090: the member's study goal from the onboarding page and My page. The
 * target level stays in "User"."targetLevel" (the same value `/me` and
 * PUT /api/v1/me/target-level use); the daily goal, when it was set and when
 * the page was skipped live in "UserStudyGoal". Guests have no study goal.
 */
export const STUDY_GOAL_PATHS = {
  goal: '/api/v1/me/study-goal',
  skip: '/api/v1/me/study-goal/skip'
} as const

export const DAILY_GOAL_MIN = 10
export const DAILY_GOAL_MAX = 150
export const DAILY_GOAL_STEP = 10
/** The value the page shows before the member has set one. */
export const DAILY_GOAL_DEFAULT = 10

export const dailyGoalSchema = z
  .number()
  .int()
  .min(DAILY_GOAL_MIN)
  .max(DAILY_GOAL_MAX)
  .multipleOf(DAILY_GOAL_STEP)

export const studyGoalResponseSchema = z
  .object({
    targetLevel: jlptLevelSchema.nullable(),
    // null until [Start] or [Save]; skipping leaves it null.
    dailyGoal: dailyGoalSchema.nullable(),
    goalSetAt: z.iso.datetime().nullable(),
    skippedAt: z.iso.datetime().nullable(),
    // true while the page was neither started nor skipped: open it once.
    onboardingRequired: z.boolean(),
    // Answers in sets submitted today (Asia/Seoul day), every level,
    // subject and mode; abandoned sets and the daily question do not count.
    todayAnsweredCount: z.number().int().nonnegative(),
    // #1094: days of this Asia/Seoul month with an attendance stamp,
    // ascending YYYY-MM-DD; empty when none.
    monthStampDates: z.array(z.iso.date()).max(31)
  })
  .strict()

/** [Start] on the onboarding page or [Save] from My page. */
export const updateStudyGoalBodySchema = z
  .object({ targetLevel: jlptLevelSchema, dailyGoal: dailyGoalSchema })
  .strict()

/** [Later]: stored only while the page was never answered. */
export const skipStudyGoalBodySchema = z.object({}).strict()

export const studyGoalErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'INVALID_JSON',
  // fieldErrors.targetLevel or fieldErrors.dailyGoal.
  'INVALID_REQUEST',
  'INVALID_CSRF',
  'UNTRUSTED_ORIGIN',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE'
])

export const studyGoalErrorSchema = createApiFailureSchema(
  studyGoalErrorCodeSchema
)

export type StudyGoal = z.output<typeof studyGoalResponseSchema>
export type UpdateStudyGoalBody = z.input<typeof updateStudyGoalBodySchema>
export type StudyGoalError = z.output<typeof studyGoalErrorSchema>

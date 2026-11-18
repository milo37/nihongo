import { describe, expect, it } from 'vitest'
import {
  DAILY_GOAL_DEFAULT,
  STUDY_GOAL_PATHS,
  dailyGoalSchema,
  skipStudyGoalBodySchema,
  studyGoalResponseSchema,
  updateStudyGoalBodySchema
} from './study-goal.js'

describe('study goal contract (#1090)', () => {
  it('takes 10 to 150 questions in tens, 10 by default', () => {
    expect(STUDY_GOAL_PATHS).toEqual({
      goal: '/api/v1/me/study-goal',
      skip: '/api/v1/me/study-goal/skip'
    })
    expect(DAILY_GOAL_DEFAULT).toBe(10)
    for (const value of [10, 20, 100, 150])
      expect(dailyGoalSchema.parse(value)).toBe(value)
    for (const value of [0, 5, 15, 160, 200, 10.5, '10'])
      expect(dailyGoalSchema.safeParse(value).success, String(value)).toBe(
        false
      )
  })

  it('saves exactly a level and a daily goal; skipping takes nothing', () => {
    expect(
      updateStudyGoalBodySchema.parse({ targetLevel: 'N3', dailyGoal: 30 })
    ).toEqual({ targetLevel: 'N3', dailyGoal: 30 })
    for (const body of [
      { targetLevel: 'N3' },
      { dailyGoal: 30 },
      { targetLevel: null, dailyGoal: 30 },
      { targetLevel: 'N3', dailyGoal: 30, skippedAt: null }
    ])
      expect(updateStudyGoalBodySchema.safeParse(body).success).toBe(false)
    expect(skipStudyGoalBodySchema.safeParse({}).success).toBe(true)
    expect(skipStudyGoalBodySchema.safeParse({ x: 1 }).success).toBe(false)
  })

  it('reads the goal, whether to open the page and today’s count', () => {
    const unanswered = {
      targetLevel: null,
      dailyGoal: null,
      goalSetAt: null,
      skippedAt: null,
      onboardingRequired: true,
      todayAnsweredCount: 0,
      monthStampDates: []
    }
    expect(studyGoalResponseSchema.parse(unanswered)).toEqual(unanswered)
    const stamped = {
      ...unanswered,
      monthStampDates: ['2026-11-01', '2026-11-18']
    }
    expect(studyGoalResponseSchema.parse(stamped)).toEqual(stamped)
    for (const invalid of [
      { todayAnsweredCount: -1 },
      // #1094: this month's stamp days are required calendar dates.
      { monthStampDates: undefined },
      { monthStampDates: ['2026-11-31'] },
      { monthStampDates: ['2026-11-18T00:00:00Z'] }
    ])
      expect(
        studyGoalResponseSchema.safeParse({ ...unanswered, ...invalid }).success
      ).toBe(false)
  })
})

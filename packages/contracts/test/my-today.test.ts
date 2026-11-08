import { describe, expect, it } from 'vitest'
import { getMyTodayResponseSchema } from '../src/dashboard/get-my-today.js'

const valid = {
  observedAt: '2026-08-16T05:00:00.000Z',
  timeZone: 'Asia/Seoul',
  today: '2026-08-16',
  streakDays: 3,
  studiedToday: true,
  todayAnsweredCount: 23,
  dailyGoal: 10,
  reviewDueCount: 0,
  latestResumableSession: null
}

describe('getMyTodayResponseSchema', () => {
  it('accepts a member card that passed the daily goal', () => {
    expect(getMyTodayResponseSchema.parse(valid)).toEqual(valid)
  })

  it.each([
    ['studied today with no streak', { streakDays: 0 }],
    ['studied today with no answers', { todayAnsweredCount: 0 }],
    ['answers without studied today', { studiedToday: false }],
    ['another goal', { dailyGoal: 20 }],
    ['another time zone', { timeZone: 'UTC' }],
    ['an unknown field', { targetLevel: 'N5' }]
  ])('rejects %s', (_label, patch) => {
    expect(
      getMyTodayResponseSchema.safeParse({ ...valid, ...patch }).success
    ).toBe(false)
  })
})

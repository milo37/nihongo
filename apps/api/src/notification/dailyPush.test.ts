import { describe, expect, it } from 'vitest'
import { dailyPushPayloadSchema } from '@nihongo/contracts/notification/web-push'
import { classifyPushStatus, dailyPushPayload, seoulDay } from './dailyPush.js'

describe('daily push (#1046)', () => {
  it.each([
    [201, 'SENT'],
    [200, 'SENT'],
    [404, 'REMOVE'],
    [410, 'REMOVE'],
    [400, 'REMOVE'],
    [413, 'REMOVE'],
    [429, 'KEEP'],
    [500, 'KEEP'],
    [503, 'KEEP'],
    [403, 'KEEP']
  ] as const)('status %i → %s', (status, outcome) => {
    expect(classifyPushStatus(status)).toBe(outcome)
  })

  it('counts the day in Korea', () => {
    // 08:00 KST is 23:00 UTC the day before.
    expect(seoulDay(new Date('2026-11-24T23:00:00Z'))).toBe('2026-11-25')
    expect(seoulDay(new Date('2026-11-24T14:59:59Z'))).toBe('2026-11-24')
  })

  it('says the daily goal and opens practice', () => {
    expect(
      dailyPushPayloadSchema.parse(JSON.parse(dailyPushPayload('ko', 30)))
    ).toEqual({
      kind: 'DAILY_GOAL',
      title: '좋은 아침이에요',
      body: '오늘도 30문제, 가볍게 풀고 가요',
      url: '/practice'
    })
    expect(JSON.parse(dailyPushPayload('ja', 150))).toMatchObject({
      title: 'おはようございます',
      body: '今日も150問、気軽に解いていきましょう'
    })
  })
})

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

  it('sends only the fixed words and the home address', () => {
    expect(
      dailyPushPayloadSchema.parse(JSON.parse(dailyPushPayload('ko')))
    ).toEqual({
      kind: 'DAILY_QUESTION',
      body: '오늘의 한 문제가 왔어요',
      url: '/'
    })
    expect(JSON.parse(dailyPushPayload('ja')).body).toBe(
      '今日の1問が届きました'
    )
  })
})

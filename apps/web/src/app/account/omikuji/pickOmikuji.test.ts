import { describe, expect, it } from 'vitest'
import {
  EXPRESSIONS,
  FORTUNES,
  FORTUNE_WEIGHTS,
  MESSAGES
} from '@app/account/omikuji/omikujiData'
import { pickOmikuji, seoulToday } from '@app/account/omikuji/pickOmikuji'

const ids = Array.from(
  { length: 10_000 },
  (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
)

describe('pickOmikuji', () => {
  it('gives the same slip for the same member and day', () => {
    expect(pickOmikuji(ids[7]!, '2026-11-20')).toEqual(
      pickOmikuji(ids[7]!, '2026-11-20')
    )
  })

  it('draws anew on another day', () => {
    const days = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']
    const slips = new Set(
      days.map((day) => JSON.stringify(pickOmikuji(ids[0]!, day)))
    )
    expect(slips.size).toBeGreaterThan(1)
  })

  it('keeps each fortune within 1 point of its weight over 10,000 members', () => {
    const counts = Object.fromEntries(FORTUNES.map((name) => [name, 0]))
    for (const id of ids) counts[pickOmikuji(id, '2026-11-20').fortune]! += 1
    for (const name of FORTUNES)
      expect(
        Math.abs(counts[name]! / 100 - FORTUNE_WEIGHTS[name])
      ).toBeLessThanOrEqual(1)
  })

  it('picks a message of that fortune and an expression in range', () => {
    for (const id of ids.slice(0, 500)) {
      const pick = pickOmikuji(id, '2026-11-20')
      expect(MESSAGES[pick.fortune][pick.messageIndex]).toBeDefined()
      expect(EXPRESSIONS[pick.expressionIndex]).toBeDefined()
    }
  })

  it('turns the day at midnight in Seoul', () => {
    expect(seoulToday(new Date('2026-11-20T14:59:59Z'))).toBe('2026-11-20')
    expect(seoulToday(new Date('2026-11-20T15:00:00Z'))).toBe('2026-11-21')
  })
})

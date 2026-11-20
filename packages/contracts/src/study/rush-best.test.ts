import { describe, expect, it } from 'vitest'
import {
  RUSH_BEST_PATH,
  RUSH_SCORE_MAX,
  rushBestResponseSchema,
  rushScoreSchema,
  submitRushScoreBodySchema,
  submitRushScoreResponseSchema
} from './rush-best.js'

const entry = {
  mode: 'KANJI_RUSH_30S',
  level: 'N3',
  best: 24,
  achievedAt: '2026-11-20T01:00:00.000Z'
}

describe('rush best contract (#1043)', () => {
  it('takes whole scores from 0 to 60', () => {
    expect(RUSH_BEST_PATH).toBe('/api/v1/me/rush-best')
    expect(RUSH_SCORE_MAX).toBe(60)
    for (const value of [0, 1, 30, 60])
      expect(rushScoreSchema.parse(value)).toBe(value)
    for (const value of [-1, 61, 10.5, '10', null])
      expect(rushScoreSchema.safeParse(value).success, String(value)).toBe(
        false
      )
  })

  it('submits exactly a mode, a level and a score', () => {
    const body = { mode: 'KANJI_RUSH_30S', level: 'N5', score: 12 }
    expect(submitRushScoreBodySchema.parse(body)).toEqual(body)
    for (const bad of [
      {},
      { mode: 'KANJI_RUSH_30S', level: 'N5' },
      { ...body, mode: 'PAIR_MATCH' },
      { ...body, level: 'N6' },
      { ...body, score: 61 },
      { ...body, achievedAt: entry.achievedAt }
    ])
      expect(submitRushScoreBodySchema.safeParse(bad).success).toBe(false)
  })

  it('answers the bests and whether this round raised one', () => {
    expect(rushBestResponseSchema.parse({ bests: [] })).toEqual({ bests: [] })
    expect(rushBestResponseSchema.parse({ bests: [entry] })).toEqual({
      bests: [entry]
    })
    expect(
      submitRushScoreResponseSchema.parse({ best: entry, isNewBest: true })
    ).toEqual({ best: entry, isNewBest: true })
    expect(
      rushBestResponseSchema.safeParse({ bests: [{ ...entry, userId: 'x' }] })
        .success
    ).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  RUSH_KANJI_PAIRS_PATH,
  RUSH_PAIRS_MAX,
  RUSH_PAIRS_MIN,
  rushKanjiPairsQuerySchema,
  rushKanjiPairsResponseSchema
} from './rush-pairs.js'

const pair = {
  id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1',
  word: '勉強',
  answer: 'べんきょう',
  wrong: ['べんきょ', 'めんきょう', 'べんぎょう']
}

describe('rush kanji pairs contract (#1043)', () => {
  it('asks for one level', () => {
    expect(RUSH_KANJI_PAIRS_PATH).toBe('/api/v1/rush/kanji-pairs')
    expect([RUSH_PAIRS_MIN, RUSH_PAIRS_MAX]).toEqual([20, 60])
    expect(rushKanjiPairsQuerySchema.parse({ level: 'N2' })).toEqual({
      level: 'N2'
    })
    for (const query of [{}, { level: 'N6' }, { level: 'N2', mode: 'x' }])
      expect(rushKanjiPairsQuerySchema.safeParse(query).success).toBe(false)
  })

  it('answers pairs with exactly three wrong readings', () => {
    const response = { level: 'N2', pairs: [pair] }
    expect(rushKanjiPairsResponseSchema.parse(response)).toEqual(response)
    for (const bad of [
      { ...pair, wrong: pair.wrong.slice(0, 2) },
      { ...pair, wrong: [...pair.wrong, 'べんきょうう'] },
      { ...pair, questionText: '「勉強」' }
    ])
      expect(
        rushKanjiPairsResponseSchema.safeParse({ level: 'N2', pairs: [bad] })
          .success
      ).toBe(false)
    expect(
      rushKanjiPairsResponseSchema.safeParse({
        level: 'N2',
        pairs: Array.from({ length: RUSH_PAIRS_MAX + 1 }, () => pair)
      }).success
    ).toBe(false)
  })
})

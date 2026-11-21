import { describe, expect, it } from 'vitest'
import {
  draftRuby,
  kanjiWithoutReading,
  parseRuby,
  toHiragana
} from './furiganaRuby.js'

describe('furigana ruby (#1182)', () => {
  it('puts each reading on its word and leaves kana plain', () => {
    const ruby = draftRuby('駅の前に図書館があります。', [
      { surface: '駅', reading: 'エキ' },
      { surface: 'の', reading: 'ノ' },
      { surface: '前', reading: 'マエ' },
      { surface: 'に', reading: 'ニ' },
      { surface: '図書館', reading: 'トショカン' },
      { surface: 'が', reading: 'ガ' },
      { surface: 'あり', reading: 'アリ' },
      { surface: 'ます', reading: 'マス' },
      { surface: '。', reading: '。' }
    ])

    expect(ruby).toBe('{駅|えき}の{前|まえ}に{図書館|としょかん}があります。')
    expect(parseRuby(ruby)).toEqual({
      text: '駅の前に図書館があります。',
      segments: [
        { start: 0, length: 1, reading: 'えき' },
        { start: 2, length: 1, reading: 'まえ' },
        { start: 4, length: 3, reading: 'としょかん' }
      ]
    })
  })

  it('splits a reading over the kanji runs around okurigana', () => {
    expect(
      draftRuby('取り扱い', [{ surface: '取り扱い', reading: 'トリアツカイ' }])
    ).toBe('{取|と}り{扱|あつか}い')
  })

  it('keeps skipped spaces and leaves a kanji without reading plain', () => {
    const ruby = draftRuby('きょうは 雨 㐂', [
      { surface: 'きょう', reading: 'キョウ' },
      { surface: 'は', reading: 'ハ' },
      { surface: '雨', reading: 'アメ' },
      { surface: '㐂' }
    ])

    expect(ruby).toBe('きょうは {雨|あめ} 㐂')
    expect(kanjiWithoutReading(ruby)).toEqual(['㐂'])
  })

  it('rejects tokens out of order and text holding ruby marks', () => {
    expect(() =>
      draftRuby('雨', [{ surface: '雪', reading: 'ユキ' }])
    ).toThrow()
    expect(() => draftRuby('{雨}', [])).toThrow()
  })

  it('rejects a reading that is not hiragana or a base without kanji', () => {
    expect(() => parseRuby('{雨|アメ}')).toThrow()
    expect(() => parseRuby('{あめ|あめ}')).toThrow()
    expect(() => parseRuby('雨|あめ}')).toThrow()
  })

  it('converts katakana readings to hiragana', () => {
    expect(toHiragana('トショカン')).toBe('としょかん')
  })
})

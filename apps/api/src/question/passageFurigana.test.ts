import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { toPassageFurigana } from './passageFurigana.js'

const passage = '駅の前\n図書館'
const textMd5 = createHash('md5').update(passage, 'utf8').digest('hex')
const segments = [
  { start: 0, length: 1, reading: 'えき' },
  { start: 4, length: 3, reading: 'としょかん' }
]

describe('passage furigana read (#1182)', () => {
  it('returns reviewed segments made for this exact text', () => {
    expect(
      toPassageFurigana(passage, { origin: 'REVIEWED', textMd5, segments })
    ).toEqual(segments)
  })

  it('hides automatic, stale, malformed or out-of-place rows', () => {
    for (const row of [
      null,
      { origin: 'AUTO', textMd5, segments },
      { origin: 'REVIEWED', textMd5: '0'.repeat(32), segments },
      { origin: 'REVIEWED', textMd5, segments: [{ start: 0 }] },
      // over the line break
      {
        origin: 'REVIEWED',
        textMd5,
        segments: [{ start: 2, length: 2, reading: 'まえ' }]
      },
      // out of order
      { origin: 'REVIEWED', textMd5, segments: [...segments].reverse() }
    ]) {
      expect(toPassageFurigana(passage, row)).toBeNull()
    }
    expect(
      toPassageFurigana(null, { origin: 'REVIEWED', textMd5, segments })
    ).toBeNull()
  })
})

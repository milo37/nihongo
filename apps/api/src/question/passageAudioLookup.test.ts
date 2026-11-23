import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFuriganaPassageList } from '../content/furiganaPassageList.js'
import { passageAudioKey } from '../content/passageAudio.js'
import { parseRuby } from '../content/furiganaRuby.js'
import {
  createPassageAudioLookup,
  loadPassageAudioList,
  passageAudioFor
} from './passageAudioLookup.js'
import { toPassageFurigana } from './passageFurigana.js'

const { text, segments } = parseRuby('{駅|えき}の前\n{図書館|としょかん}')
const engine = 'polly-neural'
const voice = 'Takumi'
const key = passageAudioKey({ text, segments, engine, voice })
const list = {
  schemaVersion: 1 as const,
  engine,
  voice,
  passages: [{ textMd5: '0'.repeat(32), key, durationMs: 4200 }]
}

describe('passage audio lookup (#1183)', () => {
  it('finds the file made for this text and these readings', () => {
    expect(createPassageAudioLookup(list)(text, segments)).toEqual({
      key,
      durationMs: 4200
    })
  })

  it('sends nothing for other text, other readings or no readings', () => {
    const lookup = createPassageAudioLookup(list)
    expect(lookup(`${text}。`, segments)).toBeNull()
    expect(
      lookup(text, [{ ...segments[0]!, reading: 'えきまえ' }, segments[1]!])
    ).toBeNull()
    expect(lookup(text, null)).toBeNull()
    expect(lookup(null, segments)).toBeNull()
    expect(
      createPassageAudioLookup({ ...list, voice: 'Kazuha' })(text, segments)
    ).toBeNull()
    expect(createPassageAudioLookup(null)(text, segments)).toBeNull()
  })

  it('reads the list in the repository and treats a missing one as empty', () => {
    expect(loadPassageAudioList()).toMatchObject({ schemaVersion: 1 })
    expect(
      loadPassageAudioList([new URL('./missing.audio.json', import.meta.url)])
    ).toBeNull()
  })

  it('fills the audio of every reviewed passage the release lists', () => {
    const furigana = parseFuriganaPassageList(
      readFileSync(
        new URL(
          '../../../../content/furigana/reading-passages.v1.json',
          import.meta.url
        )
      )
    )
    const release = loadPassageAudioList()!
    const keys = new Set(release.passages.map((entry) => entry.key))
    const reviewed = furigana.passages.filter(
      (entry) => entry.reviewedBy !== null
    )
    expect(reviewed.length).toBeGreaterThan(0)
    for (const entry of reviewed) {
      // The way a study question reads it: the stored row, then the lookup.
      const { text, segments } = parseRuby(entry.ruby)
      const shown = toPassageFurigana(text, {
        origin: 'REVIEWED',
        textMd5: entry.textMd5,
        segments
      })
      const audio = passageAudioFor(text, shown)
      expect(audio).not.toBeNull()
      expect(keys.has(audio!.key)).toBe(true)
    }
  })
})

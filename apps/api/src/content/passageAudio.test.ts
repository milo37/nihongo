import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { md5, parseFuriganaPassageList } from './furiganaPassageList.js'
import { parseRuby } from './furiganaRuby.js'
import {
  buildSsmlChunks,
  chunkedSynthesizer,
  mp3DurationMs,
  passageAudioKey,
  ssmlByteMap,
  toPassageMarks,
  type RawSpeechMark,
  type SsmlChunk
} from './passageAudio.js'
import { planPassageAudio, type PassageAudioList } from './passageAudioList.js'

const furiganaFile = new URL(
  '../../../../content/furigana/reading-passages.v1.json',
  import.meta.url
)

const passage = parseRuby(
  '{雨|あめ}が{降|ふ}った。\n{店|みせ}で<{傘|かさ}>を{買|か}った。'
)

/** A mark over the first occurrence of `from` … `to` in the SSML, by bytes. */
const markOver = (
  chunk: SsmlChunk,
  type: string,
  time: number,
  from: string,
  through: string
): RawSpeechMark => {
  const bytes = Buffer.from(chunk.ssml, 'utf8')
  const start = bytes.indexOf(from)
  const end = bytes.indexOf(through, start) + Buffer.byteLength(through)
  return {
    time,
    type,
    start,
    end,
    value: bytes.subarray(start, end).toString('utf8')
  }
}

/** MPEG-2 Layer III, 24 kHz, 32 kbps: 96-byte frames of 24 ms. */
const frames = (count: number): Uint8Array => {
  const frame = new Uint8Array(96)
  frame.set([0xff, 0xf3, 0x44, 0xc4])
  return Buffer.concat(Array.from({ length: count }, () => frame))
}

describe('passage audio (#1183)', () => {
  it('keys a file by text, readings, engine and voice', () => {
    const base = { ...passage, engine: 'polly-neural', voice: 'Takumi' }
    const key = passageAudioKey(base)
    expect(key).toMatch(/^[0-9a-f]{64}$/u)
    expect(passageAudioKey({ ...base })).toBe(key)
    expect(passageAudioKey({ ...base, voice: 'Kazuha' })).not.toBe(key)
    expect(
      passageAudioKey({
        ...base,
        segments: base.segments.map((segment, index) =>
          index === 0 ? { ...segment, reading: 'う' } : segment
        )
      })
    ).not.toBe(key)
  })

  it('reads each reading as yomigana and cuts pieces after a sentence end', () => {
    const [whole] = buildSsmlChunks(passage.text, passage.segments)
    expect(whole).toEqual({
      start: 0,
      ssml:
        '<speak><phoneme alphabet="x-amazon-yomigana" ph="あめ">雨</phoneme>が' +
        '<phoneme alphabet="x-amazon-yomigana" ph="ふ">降</phoneme>った。' +
        '<break time="500ms"/><phoneme alphabet="x-amazon-yomigana" ph="みせ">店</phoneme>で&lt;' +
        '<phoneme alphabet="x-amazon-yomigana" ph="かさ">傘</phoneme>&gt;を' +
        '<phoneme alphabet="x-amazon-yomigana" ph="か">買</phoneme>った。</speak>'
    })
    const pieces = buildSsmlChunks(passage.text, passage.segments, 200)
    expect(pieces.map(({ start }) => start)).toEqual([0, 7])
    expect(
      pieces.map(({ ssml }) => ssmlByteMap(ssml).plain.join('')).join('')
    ).toBe(passage.text)
    expect(() => buildSsmlChunks(passage.text, passage.segments, 150)).toThrow(
      'longer than a speech request'
    )
  })

  it('turns engine byte offsets into passage code points', () => {
    const pieces = buildSsmlChunks(passage.text, passage.segments, 200)
    const second = pieces[1]!
    const marks = toPassageMarks(
      [
        markOver(
          second,
          'sentence',
          0,
          '<phoneme alphabet="x-amazon-yomigana" ph="みせ">',
          '。'
        ),
        markOver(second, 'word', 10, '店', '店'),
        markOver(second, 'word', 200, '&lt;', '&lt;'),
        // a word that runs past the end of a reading, as Polly sends it
        markOver(second, 'word', 400, '買', 'っ'),
        { time: 5, type: 'ssml', start: 0, end: 7, value: '<speak>' }
      ],
      second,
      1000
    )
    expect(marks).toEqual({
      sentences: [{ time: 1000, start: 7, length: 10 }],
      words: [
        { time: 1010, start: 7, length: 1 },
        { time: 1200, start: 9, length: 1 },
        { time: 1400, start: 13, length: 2 }
      ]
    })
    const [whole] = buildSsmlChunks(passage.text, passage.segments)
    // a pause alone is no word; a sentence over a pause still matches
    expect(
      toPassageMarks(
        [
          markOver(whole!, 'word', 0, '<break', '/>'),
          markOver(
            whole!,
            'sentence',
            0,
            'った。',
            '<phoneme alphabet="x-amazon-yomigana" ph="みせ">店'
          )
        ],
        whole!,
        0
      )
    ).toEqual({ words: [], sentences: [{ time: 0, start: 3, length: 5 }] })
    expect(() =>
      toPassageMarks(
        [{ ...markOver(whole!, 'word', 0, '雨', '雨'), value: '雪' }],
        whole!,
        0
      )
    ).toThrow('does not match')
  })

  it('measures mp3 playing time from frame headers', () => {
    expect(mp3DurationMs(frames(100))).toBe(2400)
    const tagged = Buffer.concat([
      Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5]),
      Buffer.alloc(5),
      frames(10)
    ])
    expect(mp3DurationMs(tagged)).toBe(240)
    expect(() => mp3DurationMs(Buffer.from('not audio'))).toThrow()
  })

  it('joins pieces and moves each piece by the audio before it', async () => {
    const spoken: string[] = []
    const synthesizer = chunkedSynthesizer({
      engine: 'test',
      voice: 'test',
      maxLength: 200,
      speak: async (ssml) => {
        spoken.push(ssml)
        const chunk = { ssml, start: 0 }
        const first = ssmlByteMap(ssml).plain[0]!
        return {
          audio: frames(50),
          marks: [
            markOver(
              chunk,
              'word',
              7,
              first === '\n' ? '<break' : first,
              first === '\n' ? '/>' : first
            )
          ]
        }
      }
    })
    const result = await synthesizer.synthesize(passage.text, passage.segments)
    expect(spoken).toHaveLength(2)
    expect(result.audio).toHaveLength(2 * 50 * 96)
    expect(result.marks).toEqual({
      schemaVersion: 1,
      durationMs: 2400,
      words: [
        { time: 7, start: 0, length: 1 },
        { time: 1207, start: 7, length: 1 }
      ],
      sentences: []
    })
  })

  it('builds every reviewed passage without splitting a reading', () => {
    const list = parseFuriganaPassageList(readFileSync(furiganaFile))
    const plan = planPassageAudio(list, null, 'polly-neural', 'Takumi')
    expect(plan.length).toBeGreaterThan(0)
    for (const entry of plan) {
      const pieces = buildSsmlChunks(entry.text, entry.segments)
      expect(
        pieces.map(({ ssml }) => ssmlByteMap(ssml).plain.join('')).join('')
      ).toBe(entry.text)
    }
  })
})

describe('passage audio plan (#1183)', () => {
  const md5Of = (ruby: string) => md5(parseRuby(ruby).text)

  it('skips unreviewed passages, reuses made files and remakes on a voice change', () => {
    const rain = '{雨|あめ}です。'
    const snow = '{雪|ゆき}です。'
    const furigana = parseFuriganaPassageList(
      JSON.stringify({
        schemaVersion: 1,
        generator: 'test',
        passages: [
          {
            level: 'N5',
            subject: 'READING',
            textMd5: md5Of(rain),
            ruby: rain,
            reviewedBy: 'content',
            reviewedAt: '2026-11-22'
          },
          {
            level: 'N4',
            subject: 'READING',
            textMd5: md5Of(rain),
            ruby: rain,
            reviewedBy: 'content',
            reviewedAt: '2026-11-22'
          },
          {
            level: 'N5',
            subject: 'READING',
            textMd5: md5Of(snow),
            ruby: snow,
            reviewedBy: null,
            reviewedAt: null
          }
        ]
      })
    )
    const [first, ...rest] = planPassageAudio(furigana, null, 'e', 'v')
    expect(rest).toEqual([])
    expect(first).toMatchObject({ textMd5: md5Of(rain), made: null })
    const made: PassageAudioList = {
      schemaVersion: 1,
      engine: 'e',
      voice: 'v',
      passages: [{ textMd5: first!.textMd5, key: first!.key, durationMs: 900 }]
    }
    expect(planPassageAudio(furigana, made, 'e', 'v')[0]!.made).toEqual(
      made.passages[0]
    )
    expect(planPassageAudio(furigana, made, 'e', 'w')[0]!.made).toBeNull()
  })
})

import { createHash } from 'node:crypto'
import type { FuriganaSegment } from '@nihongo/contracts/question/get-question'
import type {
  PassageAudioMark,
  PassageAudioMarks
} from '@nihongo/contracts/question/passage-audio'
import { z } from 'zod'

/**
 * #1183: read-aloud audio for a reading passage, made ahead of time. The
 * speech engine sits behind PassageSynthesizer, so changing engines changes
 * one implementation; learners only see an mp3 and a timing file whose
 * positions count code points of the passage, like passageFurigana.
 */
export const PASSAGE_AUDIO_VERSION = 1

export type PassageSynthesizer = {
  readonly engine: string
  readonly voice: string
  synthesize: (
    text: string,
    segments: readonly FuriganaSegment[]
  ) => Promise<{ audio: Uint8Array; marks: PassageAudioMarks }>
}

/** A change to the text, readings, voice, engine or version is a new file. */
export const passageAudioKey = (input: {
  text: string
  segments: readonly FuriganaSegment[]
  engine: string
  voice: string
}): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        'passage-audio',
        PASSAGE_AUDIO_VERSION,
        input.engine,
        input.voice,
        input.text,
        input.segments.map(({ start, length, reading }) => [
          start,
          length,
          reading
        ])
      ]),
      'utf8'
    )
    .digest('hex')

export type SsmlChunk = { readonly ssml: string; readonly start: number }

const LINE_BREAK = '<break time="500ms"/>'
const SENTENCE_END = new Set(['。', '！', '？', '\n'])
const escapeXml = (text: string): string =>
  text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')

/**
 * SSML pieces of at most maxLength code points, cut after a sentence end or
 * a line break so no reading is split. Each kanji group with a reading
 * becomes a yomigana phoneme; a line break becomes a short pause.
 */
export const buildSsmlChunks = (
  text: string,
  segments: readonly FuriganaSegment[],
  maxLength = 5000
): SsmlChunk[] => {
  const characters = Array.from(text)
  const units: { ssml: string; start: number }[] = []
  let unit = ''
  let unitStart = 0
  let index = 0
  let next = 0
  while (index < characters.length) {
    const segment = segments[next]
    let piece: string
    let last: string
    if (segment?.start === index) {
      const base = characters.slice(index, index + segment.length).join('')
      piece = `<phoneme alphabet="x-amazon-yomigana" ph="${segment.reading}">${escapeXml(base)}</phoneme>`
      last = characters[index + segment.length - 1] ?? ''
      index += segment.length
      next += 1
    } else {
      last = characters[index] ?? ''
      piece = last === '\n' ? LINE_BREAK : escapeXml(last)
      index += 1
    }
    unit += piece
    if (SENTENCE_END.has(last) || index === characters.length) {
      units.push({ ssml: unit, start: unitStart })
      unit = ''
      unitStart = index
    }
  }
  if (next !== segments.length) throw new Error('Readings outside the text.')
  const chunks: SsmlChunk[] = []
  let body = ''
  let start = 0
  const wrap = (inner: string) => `<speak>${inner}</speak>`
  for (const piece of units) {
    if (Array.from(wrap(piece.ssml)).length > maxLength) {
      throw new Error('One sentence is longer than a speech request.')
    }
    if (body && Array.from(wrap(body + piece.ssml)).length > maxLength) {
      chunks.push({ ssml: wrap(body), start })
      body = ''
      start = piece.start
    }
    body += piece.ssml
  }
  if (body) chunks.push({ ssml: wrap(body), start })
  return chunks
}

/**
 * The plain text an SSML piece reads, and for each UTF-8 byte offset of the
 * SSML the code point offset in that text. Bytes inside a tag point at the
 * next character; a pause tag stands for the line break it replaced.
 */
export const ssmlByteMap = (
  ssml: string
): { plain: string[]; at: Map<number, number> } => {
  const plain: string[] = []
  const at = new Map<number, number>()
  const characters = Array.from(ssml)
  let byte = 0
  let index = 0
  const advance = (count: number, position: number) => {
    for (let k = 0; k < count; k += 1) {
      const size = Buffer.byteLength(characters[index] ?? '', 'utf8')
      for (let b = 0; b < size; b += 1) at.set(byte + b, position)
      byte += size
      index += 1
    }
  }
  while (index < characters.length) {
    const character = characters[index]
    if (character === '<') {
      const close = characters.indexOf('>', index)
      const tag = characters.slice(index, close + 1).join('')
      if (tag === LINE_BREAK) {
        advance(close + 1 - index, plain.length)
        plain.push('\n')
      } else {
        advance(close + 1 - index, plain.length)
      }
    } else if (character === '&') {
      const close = characters.indexOf(';', index)
      const entity = characters.slice(index, close + 1).join('')
      const decoded = { '&amp;': '&', '&lt;': '<', '&gt;': '>' }[entity]
      if (decoded === undefined) throw new Error(`Unknown entity ${entity}.`)
      advance(close + 1 - index, plain.length)
      plain.push(decoded)
    } else {
      advance(1, plain.length)
      plain.push(character ?? '')
    }
  }
  at.set(byte, plain.length)
  return { plain, at }
}

export const rawSpeechMarkSchema = z.object({
  time: z.number().int().min(0),
  type: z.string(),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  value: z.string()
})

export type RawSpeechMark = z.infer<typeof rawSpeechMarkSchema>

const withoutTags = (value: string): string =>
  value
    .replace(/<[^>]*>/gu, '')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&')
const compact = (value: string): string => value.replace(/\s/gu, '')

/**
 * Engine marks over one SSML piece → passage marks. A mark that is only a
 * tag (a pause) is dropped; any mark whose span does not read its own value
 * fails the passage rather than highlight the wrong words.
 */
export const toPassageMarks = (
  raw: readonly RawSpeechMark[],
  chunk: SsmlChunk,
  timeOffsetMs: number
): { words: PassageAudioMark[]; sentences: PassageAudioMark[] } => {
  const { plain, at } = ssmlByteMap(chunk.ssml)
  const words: PassageAudioMark[] = []
  const sentences: PassageAudioMark[] = []
  for (const mark of raw) {
    if (mark.type !== 'word' && mark.type !== 'sentence') continue
    const value = withoutTags(mark.value)
    if (!compact(value)) continue
    const start = at.get(mark.start)
    const end = at.get(mark.end)
    if (
      start === undefined ||
      end === undefined ||
      end <= start ||
      compact(plain.slice(start, end).join('')) !== compact(value)
    ) {
      throw new Error(`Speech mark does not match the text: ${mark.value}`)
    }
    const target = mark.type === 'word' ? words : sentences
    target.push({
      time: mark.time + timeOffsetMs,
      start: chunk.start + start,
      length: end - start
    })
  }
  return { words, sentences }
}

const BITRATES_V1 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320
]
const BITRATES_V2 = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160
]
const SAMPLE_RATES: Record<number, readonly number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000]
}

/** Playing time of an MPEG Layer III file, from its frame headers. */
export const mp3DurationMs = (bytes: Uint8Array): number => {
  let offset = 0
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size =
      ((bytes[6]! & 0x7f) << 21) |
      ((bytes[7]! & 0x7f) << 14) |
      ((bytes[8]! & 0x7f) << 7) |
      (bytes[9]! & 0x7f)
    offset = 10 + size
  }
  let samples = 0
  let sampleRate = 0
  while (offset + 4 <= bytes.length) {
    const b1 = bytes[offset + 1]!
    const b2 = bytes[offset + 2]!
    const version = (b1 >> 3) & 3
    const rate = SAMPLE_RATES[version]?.[(b2 >> 2) & 3]
    const bitrate = (version === 3 ? BITRATES_V1 : BITRATES_V2)[b2 >> 4]
    if (
      bytes[offset] !== 0xff ||
      (b1 & 0xe0) !== 0xe0 ||
      ((b1 >> 1) & 3) !== 1 ||
      !rate ||
      !bitrate
    ) {
      throw new Error(`Not an MPEG Layer III frame at byte ${offset}.`)
    }
    const perFrame = version === 3 ? 1152 : 576
    offset +=
      Math.floor(((perFrame / 8) * bitrate * 1000) / rate) + ((b2 >> 1) & 1)
    samples += perFrame
    sampleRate = rate
  }
  if (!sampleRate) throw new Error('No audio frames.')
  return Math.round((samples * 1000) / sampleRate)
}

/**
 * A synthesizer over an engine that takes one SSML piece at a time: pieces
 * are joined in order, and each piece's marks move by the playing time of
 * the audio before it (pauses included).
 */
export const chunkedSynthesizer = (options: {
  engine: string
  voice: string
  maxLength?: number
  speak: (
    ssml: string
  ) => Promise<{ audio: Uint8Array; marks: RawSpeechMark[] }>
}): PassageSynthesizer => ({
  engine: options.engine,
  voice: options.voice,
  synthesize: async (text, segments) => {
    const parts: Uint8Array[] = []
    const words: PassageAudioMark[] = []
    const sentences: PassageAudioMark[] = []
    let elapsed = 0
    for (const chunk of buildSsmlChunks(text, segments, options.maxLength)) {
      const spoken = await options.speak(chunk.ssml)
      const marks = toPassageMarks(spoken.marks, chunk, elapsed)
      words.push(...marks.words)
      sentences.push(...marks.sentences)
      parts.push(spoken.audio)
      elapsed += mp3DurationMs(spoken.audio)
    }
    return {
      audio: Buffer.concat(parts),
      marks: { schemaVersion: 1, durationMs: elapsed, words, sentences }
    }
  }
})

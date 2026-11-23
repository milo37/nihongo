import type {
  PassageAudioMarks,
  PassageAudioRef
} from '@nihongo/contracts/question/passage-audio'
import { mockFuriganaPassages } from '@mocks/data/passageFurigana'

// #1183 mock: every passage with reviewed readings gets "audio" — silence as
// long as the passage, with one word every WORD_MS — so the bar and the
// reading word can be tried without the real files.
const WORD_MS = 300
const TAIL_MS = 600
const SAMPLE_RATE = 8000

const fnv = (text: string): string => {
  let value = 0x811c9dc5
  for (const point of text) {
    value ^= point.codePointAt(0)!
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value.toString(16).padStart(8, '0')
}

// The real key is a 64-hex content hash; eight salted FNV rounds give the
// same shape.
const hash = (text: string): string =>
  Array.from({ length: 8 }, (_, round) => fnv(`${round}:${text}`)).join('')

const ENTRIES = new Map(
  mockFuriganaPassages().map((passage) => [hash(passage), passage])
)
const KEYS = new Map([...ENTRIES].map(([key, passage]) => [passage, key]))

export const mockPassageAudioMarks = (
  key: string
): PassageAudioMarks | null => {
  const passage = ENTRIES.get(key)
  if (passage === undefined) return null
  const words: PassageAudioMarks['words'] = []
  const sentences: PassageAudioMarks['sentences'] = []
  let at = 0
  let sentence: { time: number; start: number } | null = null
  for (const { segment, isWordLike } of new Intl.Segmenter('ja', {
    granularity: 'word'
  }).segment(passage)) {
    const length = Array.from(segment).length
    if (isWordLike) {
      const time = words.length * WORD_MS
      words.push({ time, start: at, length })
      sentence ??= { time, start: at }
    }
    at += length
    if (sentence && /[。！？]/u.test(segment)) {
      sentences.push({ ...sentence, length: at - sentence.start })
      sentence = null
    }
  }
  if (sentence) sentences.push({ ...sentence, length: at - sentence.start })
  return {
    schemaVersion: 1,
    durationMs: words.length * WORD_MS + TAIL_MS,
    words,
    sentences
  }
}

/** The question's `passageAudio` for a mock passage, or null. */
export const mockPassageAudio = (
  passage: string | null
): PassageAudioRef | null => {
  const key = passage === null ? undefined : KEYS.get(passage)
  const marks = key === undefined ? null : mockPassageAudioMarks(key)
  return key === undefined || !marks
    ? null
    : { key, durationMs: marks.durationMs }
}

/** 8-bit mono silence, `durationMs` long, as a WAV file. */
export const mockSilentWav = (durationMs: number): Uint8Array<ArrayBuffer> => {
  const samples = Math.ceil((SAMPLE_RATE * durationMs) / 1000)
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1)
      bytes[offset + index] = value.charCodeAt(index)
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  text(36, 'data')
  view.setUint32(40, samples, true)
  bytes.fill(128, 44)
  return bytes
}

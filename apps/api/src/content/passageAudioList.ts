import { z } from 'zod'
import { parseRuby } from './furiganaRuby.js'
import type { FuriganaPassageList } from './furiganaPassageList.js'
import { passageAudioKey } from './passageAudio.js'

/**
 * #1183: content/audio/reading-passages.audio.v1.json, the read-aloud files
 * that have been made, one entry per passage text with reviewed readings.
 * The files live at /audio/passages/<key>.mp3 and <key>.marks.json.
 */
const entrySchema = z
  .object({
    textMd5: z.string().regex(/^[0-9a-f]{32}$/u),
    key: z.string().regex(/^[0-9a-f]{64}$/u),
    durationMs: z.number().int().min(1)
  })
  .strict()

const listSchema = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.string().min(1),
    voice: z.string().min(1),
    passages: z.array(entrySchema)
  })
  .strict()

export type PassageAudioEntry = z.infer<typeof entrySchema>
export type PassageAudioList = z.infer<typeof listSchema>

export const parsePassageAudioList = (text: string): PassageAudioList =>
  listSchema.parse(JSON.parse(text))

export type PlannedPassageAudio = {
  textMd5: string
  key: string
  text: string
  segments: ReturnType<typeof parseRuby>['segments']
  // Set when the file with this key was made before.
  made: PassageAudioEntry | null
}

/**
 * One plan entry per passage text whose readings were reviewed, in textMd5
 * order. Unreviewed passages get no audio: a wrong reading would be spoken.
 */
export const planPassageAudio = (
  furigana: FuriganaPassageList,
  current: PassageAudioList | null,
  engine: string,
  voice: string
): PlannedPassageAudio[] => {
  const made = new Map(
    current && current.engine === engine && current.voice === voice
      ? current.passages.map((entry) => [entry.key, entry])
      : []
  )
  const byText = new Map<string, PlannedPassageAudio>()
  for (const entry of furigana.passages) {
    if (entry.reviewedBy === null || byText.has(entry.textMd5)) continue
    const { text, segments } = parseRuby(entry.ruby)
    const key = passageAudioKey({ text, segments, engine, voice })
    byText.set(entry.textMd5, {
      textMd5: entry.textMd5,
      key,
      text,
      segments,
      made: made.get(key) ?? null
    })
  }
  return [...byText.values()].sort((a, b) =>
    a.textMd5 < b.textMd5 ? -1 : a.textMd5 > b.textMd5 ? 1 : 0
  )
}

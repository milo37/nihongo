import { readFileSync } from 'node:fs'
import type { FuriganaSegment } from '@nihongo/contracts/question/get-question'
import type { PassageAudioRef } from '@nihongo/contracts/question/passage-audio'
import { passageAudioKey } from '../content/passageAudio.js'
import {
  parsePassageAudioList,
  type PassageAudioList
} from '../content/passageAudioList.js'

export type PassageAudioLookup = (
  passage: string | null,
  segments: readonly FuriganaSegment[] | null
) => PassageAudioRef | null

/**
 * #1183: the read-aloud file made for exactly this passage text and the
 * readings the learner sees. The key is worked out from both, so audio made
 * for another text or other readings is never sent. No readings, no audio.
 */
export const createPassageAudioLookup = (
  list: PassageAudioList | null
): PassageAudioLookup => {
  if (!list || list.passages.length === 0) return () => null
  const durations = new Map(
    list.passages.map((entry) => [entry.key, entry.durationMs])
  )
  return (passage, segments) => {
    if (passage === null || segments === null) return null
    const key = passageAudioKey({
      text: passage,
      segments,
      engine: list.engine,
      voice: list.voice
    })
    const durationMs = durations.get(key)
    return durationMs === undefined ? null : { key, durationMs }
  }
}

// content/audio/reading-passages.audio.v1.json: /app/content in the image
// (from /app/api/dist/question), the repository root from apps/api/*/question.
const LIST_FILES = [
  new URL(
    '../../../content/audio/reading-passages.audio.v1.json',
    import.meta.url
  ),
  new URL(
    '../../../../content/audio/reading-passages.audio.v1.json',
    import.meta.url
  )
]

/** The first list that exists; none means no audio. A bad list throws. */
export const loadPassageAudioList = (
  files: readonly URL[] = LIST_FILES
): PassageAudioList | null => {
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    return parsePassageAudioList(text)
  }
  return null
}

let releaseLookup: PassageAudioLookup | undefined

/** The release's list, read once on first use. */
export const passageAudioFor: PassageAudioLookup = (passage, segments) => {
  releaseLookup ??= createPassageAudioLookup(loadPassageAudioList())
  return releaseLookup(passage, segments)
}

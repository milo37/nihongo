import type { PassageAudioMark } from '@nihongo/contracts/question/passage-audio'

/** The last word that has started by `ms`, or null before the first one. */
export const wordAt = (
  words: readonly PassageAudioMark[],
  ms: number
): PassageAudioMark | null => {
  let low = 0
  let high = words.length - 1
  let found: PassageAudioMark | null = null
  while (low <= high) {
    const middle = (low + high) >> 1
    const word = words[middle]!
    if (word.time <= ms) {
      found = word
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

/** The playback speeds, in the order the speed chip steps through them. */
export const AUDIO_RATES = [1, 1.25, 0.75] as const
export type AudioRate = (typeof AUDIO_RATES)[number]

export const nextAudioRate = (rate: AudioRate): AudioRate =>
  AUDIO_RATES[(AUDIO_RATES.indexOf(rate) + 1) % AUDIO_RATES.length]!

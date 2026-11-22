import {
  passageAudioMarksSchema,
  type PassageAudioMarks
} from '@nihongo/contracts/question/passage-audio'

/**
 * #1183: which passages have read-aloud audio, by passage text. The learner
 * API will send the key with the question (a separate server change); until
 * then only the mock server fills this, so the real app shows no [듣기].
 */
const keys = new Map<string, string>()

export const registerPassageAudio = (passage: string, key: string): void => {
  keys.set(passage, key)
}

export const passageAudioKey = (passage: string | null): string | null =>
  passage === null ? null : (keys.get(passage) ?? null)

// Same site as the app (#1219), so no other origin is allowed in.
export const passageAudioUrl = (key: string): string =>
  `/audio/passages/${encodeURIComponent(key)}.mp3`

export const fetchPassageAudioMarks = async (
  key: string,
  signal: AbortSignal
): Promise<PassageAudioMarks> => {
  const response = await fetch(
    `/audio/passages/${encodeURIComponent(key)}.marks.json`,
    { signal }
  )
  if (!response.ok) throw new Error(`Passage marks ${response.status}`)
  return passageAudioMarksSchema.parse(await response.json())
}

import {
  passageAudioMarksSchema,
  type PassageAudioMarks
} from '@nihongo/contracts/question/passage-audio'

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

import type { PassageAudioMark } from '@nihongo/contracts/question/passage-audio'
import type { PassageParagraph } from '@app/practice/session/passageParagraphs'
import type { JaMark } from '@common/components/JaText'

/**
 * #1183: the reading word's part inside one paragraph, as UTF-16 offsets of
 * `paragraph.text`. Marks count code points over the whole passage, like
 * the furigana groups, so the paragraph start moves them.
 */
export const paragraphMark = (
  paragraph: PassageParagraph,
  word: PassageAudioMark | null
): JaMark | undefined => {
  if (!word) return undefined
  const points = Array.from(paragraph.text)
  const from = Math.max(0, word.start - paragraph.start)
  const to = Math.min(points.length, word.start + word.length - paragraph.start)
  if (to <= from) return undefined
  const offset = (index: number): number =>
    points.slice(0, index).join('').length
  return { from: offset(from), to: offset(to) }
}

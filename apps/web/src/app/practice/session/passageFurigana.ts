import type { FuriganaSegment } from '@nihongo/contracts/question/get-question'
import type { PassageParagraph } from '@app/practice/session/passageParagraphs'
import type { JaRuby } from '@common/components/JaText'

/**
 * #1182: the furigana groups that fall inside one paragraph, as UTF-16
 * ranges of `paragraph.text`. Groups are counted in code points over the
 * whole passage, so they are moved by the paragraph start. A group outside
 * the paragraph, over a cut space or over the previous group is dropped,
 * so a bad group loses its reading instead of breaking the text.
 */
export const paragraphRuby = (
  paragraph: PassageParagraph,
  segments: readonly FuriganaSegment[]
): readonly JaRuby[] => {
  const points = Array.from(paragraph.text)
  // UTF-16 offset of each code point, plus the end.
  const offsets = [0]
  for (const point of points) offsets.push(offsets.at(-1)! + point.length)
  const ruby: JaRuby[] = []
  let used = 0
  for (const { start, length, reading } of segments) {
    const from = start - paragraph.start
    if (from < used || from + length > points.length) continue
    ruby.push({ from: offsets[from]!, to: offsets[from + length]!, reading })
    used = from + length
  }
  return ruby
}

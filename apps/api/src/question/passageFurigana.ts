import { createHash } from 'node:crypto'
import {
  furiganaSegmentSchema,
  type FuriganaSegment
} from '@nihongo/contracts/question/get-question'
import { z } from 'zod'

const segmentsSchema = z.array(furiganaSegmentSchema)

export interface PassageFuriganaRow {
  readonly origin: string
  readonly textMd5: string
  readonly segments: unknown
}

/**
 * #1182: the passage furigana a learner may see: reviewed, made for exactly
 * this text, and every group inside it in order without a space or line
 * break. Anything else is null, so a bad row hides instead of misreading.
 */
export const toPassageFurigana = (
  passage: string | null,
  row: PassageFuriganaRow | null | undefined
): FuriganaSegment[] | null => {
  if (passage === null || !row || row.origin !== 'REVIEWED') return null
  if (createHash('md5').update(passage, 'utf8').digest('hex') !== row.textMd5) {
    return null
  }
  const parsed = segmentsSchema.safeParse(row.segments)
  if (!parsed.success) return null
  const characters = Array.from(passage)
  let end = 0
  for (const segment of parsed.data) {
    const stop = segment.start + segment.length
    if (
      segment.start < end ||
      stop > characters.length ||
      characters.slice(segment.start, stop).some((char) => /\s/u.test(char))
    ) {
      return null
    }
    end = stop
  }
  return parsed.data
}

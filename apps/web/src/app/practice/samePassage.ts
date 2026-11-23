/** #986: what a same-passage check needs from a question. */
type PassageRef = {
  readonly passage: string | null
  readonly passageId?: string | null
}

/**
 * Two questions share a passage: the same passage id when both have one,
 * else the same passage text.
 */
export const isSamePassage = (a: PassageRef, b: PassageRef): boolean => {
  if (a.passage === null || b.passage === null) return false
  return a.passageId && b.passageId
    ? a.passageId === b.passageId
    : a.passage === b.passage
}

/**
 * The index of the first question in the same-passage run that `index` is
 * part of, or null when `index` starts its run (or has no passage).
 */
export const samePassageStart = (
  items: readonly PassageRef[],
  index: number
): number | null => {
  let start = index
  while (start > 0 && isSamePassage(items[start - 1]!, items[index]!))
    start -= 1
  return start === index ? null : start
}

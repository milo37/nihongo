const UNICODE_WHITESPACE = /\p{White_Space}/u
const UNICODE_WHITESPACE_RUN = /\p{White_Space}+/gu
const LEADING_UNICODE_WHITESPACE = /^\p{White_Space}+/u
const TRAILING_UNICODE_WHITESPACE = /\p{White_Space}+$/u

export const isWellFormedUnicode = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const following = value.charCodeAt(index + 1)
      if (
        !Number.isInteger(following) ||
        following < 0xdc00 ||
        following > 0xdfff
      ) {
        return false
      }
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

export const countUnicodeScalars = (value: string): number =>
  Array.from(value).length

export const compareUnicodeScalars = (left: string, right: string): number => {
  const leftScalars = Array.from(left, (value) => value.codePointAt(0) ?? 0)
  const rightScalars = Array.from(right, (value) => value.codePointAt(0) ?? 0)
  const sharedLength = Math.min(leftScalars.length, rightScalars.length)

  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (leftScalars[index] ?? 0) - (rightScalars[index] ?? 0)
    if (difference !== 0) return difference
  }

  return leftScalars.length - rightScalars.length
}

export const hasUnicodeEdgeWhitespace = (value: string): boolean =>
  value.length > 0 &&
  (UNICODE_WHITESPACE.test(value[0] ?? '') ||
    UNICODE_WHITESPACE.test(value.at(-1) ?? ''))

export const collapseUnicodeWhitespace = (value: string): string =>
  value.replace(UNICODE_WHITESPACE_RUN, ' ')

export const trimUnicodeWhitespace = (value: string): string =>
  value
    .replace(LEADING_UNICODE_WHITESPACE, '')
    .replace(TRAILING_UNICODE_WHITESPACE, '')

export const asciiLowercase = (value: string): string =>
  value.replace(/[A-Z]/g, (character) => character.toLowerCase())

export const normalizeTagKey = (value: string): string =>
  asciiLowercase(
    collapseUnicodeWhitespace(trimUnicodeWhitespace(value.normalize('NFKC')))
  )

export const normalizeDuplicateText = (value: string): string =>
  asciiLowercase(
    collapseUnicodeWhitespace(trimUnicodeWhitespace(value.normalize('NFKC')))
  )

export const normalizeOptionComparison = (value: string): string =>
  collapseUnicodeWhitespace(trimUnicodeWhitespace(value.normalize('NFKC')))

export const isNfc = (value: string): boolean =>
  value.normalize('NFC') === value

export const containsForbiddenControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (
      codePoint === 0 ||
      (codePoint >= 0x01 && codePoint <= 0x09) ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0d && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      return true
    }
  }
  return false
}

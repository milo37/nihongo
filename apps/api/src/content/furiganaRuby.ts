/**
 * #1182: furigana as one ruby string per text, e.g. `{駅|えき}の{前|まえ}に`,
 * so a reviewer corrects readings in place. The table keeps the same readings
 * as segments: `start` and `length` count characters (code points) of the
 * plain text.
 */
export type FuriganaSegment = {
  start: number
  length: number
  reading: string
}

export type FuriganaToken = {
  surface: string
  reading?: string | undefined
}

const KANJI = /[㐀-䶿一-鿿豈-﫿々〆ヶ]/u
const KANJI_RUN = /[㐀-䶿一-鿿豈-﫿々〆ヶ]+/gu
const HIRAGANA_READING = /^[ぁ-ゖー]+$/u
const RUBY_MARK = /[{}|]/u

export const hasKanji = (value: string): boolean => KANJI.test(value)

export const toHiragana = (value: string): string =>
  value.replace(/[ァ-ヶ]/gu, (char) =>
    String.fromCodePoint((char.codePointAt(0) ?? 0) - 0x60)
  )

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

/**
 * Splits one word's reading over its kanji runs, leaving its kana plain:
 * 取り扱い + とりあつかい → {取|と}り{扱|あつか}い. Null when the kana do not
 * line up with the reading.
 */
const rubyWord = (surface: string, reading: string): string | null => {
  const parts = surface.split(/([㐀-䶿一-鿿豈-﫿々〆ヶ]+)/u)
  const pattern = parts
    .map((part) =>
      part === ''
        ? ''
        : hasKanji(part)
          ? '(.+?)'
          : escapeRegExp(toHiragana(part))
    )
    .join('')
  const match = new RegExp(`^${pattern}$`, 'u').exec(reading)
  if (!match) return null
  let group = 1
  return parts
    .map((part) => (hasKanji(part) ? `{${part}|${match[group++]}}` : part))
    .join('')
}

/**
 * Builds the reviewable ruby string from analyzer tokens. Tokens must cover
 * the text in order; text the analyzer skipped (spaces) is kept as is. Kanji
 * the analyzer gave no hiragana reading for stay plain for the reviewer.
 */
export const draftRuby = (
  text: string,
  tokens: readonly FuriganaToken[]
): string => {
  if (RUBY_MARK.test(text)) {
    throw new Error('Passage text contains a ruby mark ({, } or |).')
  }
  let cursor = 0
  let ruby = ''
  for (const token of tokens) {
    const at = text.indexOf(token.surface, cursor)
    if (token.surface === '' || at < 0) {
      throw new Error(`Token ${JSON.stringify(token.surface)} is not in order.`)
    }
    ruby += text.slice(cursor, at)
    cursor = at + token.surface.length
    if (!hasKanji(token.surface)) {
      ruby += token.surface
      continue
    }
    const reading = toHiragana(token.reading ?? '')
    const word = HIRAGANA_READING.test(reading)
      ? rubyWord(token.surface, reading)
      : null
    if (word !== null) {
      ruby += word
      continue
    }
    // A reading that does not split cleanly covers the whole word.
    ruby += HIRAGANA_READING.test(reading)
      ? `{${token.surface}|${reading}}`
      : token.surface
  }
  return ruby + text.slice(cursor)
}

/**
 * Reads a ruby string back into its plain text and segments. Rejects a
 * reading that is not hiragana, a base without kanji and stray marks.
 */
export const parseRuby = (
  ruby: string
): { text: string; segments: FuriganaSegment[] } => {
  const segments: FuriganaSegment[] = []
  let text = ''
  let length = 0
  const pattern = /\{([^{}|]+)\|([^{}|]+)\}/gu
  let last = 0
  for (const match of ruby.matchAll(pattern)) {
    const plain = ruby.slice(last, match.index)
    if (RUBY_MARK.test(plain)) throw new Error('Stray ruby mark.')
    const base = match[1] ?? ''
    const reading = match[2] ?? ''
    if (!hasKanji(base) || !HIRAGANA_READING.test(reading)) {
      throw new Error(`Bad ruby ${match[0]}.`)
    }
    text += plain
    length += [...plain].length
    const baseLength = [...base].length
    segments.push({ start: length, length: baseLength, reading })
    text += base
    length += baseLength
    last = match.index + match[0].length
  }
  const tail = ruby.slice(last)
  if (RUBY_MARK.test(tail)) throw new Error('Stray ruby mark.')
  text += tail
  return { text, segments }
}

/** Kanji left without a reading, in text order, for the review counts. */
export const kanjiWithoutReading = (ruby: string): string[] =>
  [...ruby.replace(/\{[^{}|]+\|[^{}|]+\}/gu, '').matchAll(KANJI_RUN)].map(
    (match) => match[0]
  )

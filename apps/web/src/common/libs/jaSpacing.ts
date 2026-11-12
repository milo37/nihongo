/**
 * JLP-864: Japanese written with spaces between words (分かち書き) reads
 * the spaces as word edges, so a line may only break at them. Text written
 * without spaces keeps ordinary Japanese breaking. Decided from the string
 * at render time, so content that drops its spaces switches by itself.
 * Only an ASCII space between two characters counts; the full-width space
 * (U+3000) inside a fill-in blank is not a word space.
 */
export const isJaSpaced = (text: string | null | undefined): boolean =>
  text ? /\S \S/u.test(text) : false

/** Props for a Japanese text element; the CSS reads data-ja-spaced. */
export const jaTextProps = (
  text: string | null | undefined
): { lang: 'ja'; 'data-ja-spaced'?: true } =>
  isJaSpaced(text) ? { lang: 'ja', 'data-ja-spaced': true } : { lang: 'ja' }

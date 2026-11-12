/**
 * JLP-864/868: Japanese written with spaces between words (分かち書き) reads
 * the spaces as word edges, so a line may only break at them. Text written
 * without spaces keeps ordinary Japanese breaking. Decided from the string
 * at render time, so content that drops its spaces switches by itself.
 *
 * Only a half-width space with a word character on both sides counts: kana,
 * kanji, ー, 々, or the ＿＿/★ marks of a word-order item. Spaces next to
 * numbers or symbols (`13:30～15:00`, `1回 150円`) do not, and neither does
 * the full-width space of a fill-in blank. A notice that spaces only its heading still
 * reads as unspaced: the text counts as spaced only when the pieces between
 * word spaces stay short (word-spaced N5/N4 text averages under 12 Japanese
 * letters a piece; a spaced heading over a prose notice averages over 80).
 */
const JA_LETTERS = 'ぁ-ゖァ-ヺー一-鿿々'
const WORD_CHAR = `[${JA_LETTERS}＿★]`
const WORD_SPACE = new RegExp(`${WORD_CHAR} (?=${WORD_CHAR})`, 'gu')
const JA_LETTER = new RegExp(`[${JA_LETTERS}]`, 'gu')
const MAX_LETTERS_PER_PIECE = 20

export const isJaSpaced = (text: string | null | undefined): boolean => {
  if (!text) return false
  const spaces = text.match(WORD_SPACE)?.length ?? 0
  if (spaces === 0) return false
  const letters = text.match(JA_LETTER)?.length ?? 0
  return letters / (spaces + 1) <= MAX_LETTERS_PER_PIECE
}

/** Props for a Japanese text element; the CSS reads data-ja-spaced. */
export const jaTextProps = (
  text: string | null | undefined
): { lang: 'ja'; 'data-ja-spaced'?: true } =>
  isJaSpaced(text) ? { lang: 'ja', 'data-ja-spaced': true } : { lang: 'ja' }

// JLP-865: WebKit with keep-all can break between a bracket or mark and its
// neighbour (a line ending in 「, or starting with 。」）) even with
// line-break: strict. These pieces are kept on one line: an opening bracket
// with the next letter, a closing mark or ー run with the letter before it,
// and a fill-in blank with the marks after it. Each piece is a few letters
// long. A full-width space after a mark joins the piece, so the piece wraps
// whole instead of pushing the space past the line end.
const HELD_PIECE =
  /(（\u3000）[」』）】、。]*|[「『（【]+[^\s「『（【]|[^\s」』）】、。ー][」』）】、。ー]+\u3000?)/u

/** The text split for display: odd entries are pieces to keep unbroken. */
export const jaLineSegments = (text: string): readonly string[] =>
  text.split(HELD_PIECE)

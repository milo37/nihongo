export type PassageParagraph = {
  readonly text: string
  readonly indent: boolean
  /** The text split around fill-in blanks: odd entries are blanks. */
  readonly segments: readonly string[]
}

// A line that opens with a list mark, a bracket or a number is part of a
// notice or a list, so it sits on the left line with no indent.
const NO_INDENT_START = /^[■・●○※【(（0-9０-９\u2460-\u2473]/u

// WebKit with keep-all may break inside a fill-in blank or between it and
// the next 。/、, so a line can open with ） or 。. Each blank (with that
// mark) is its own segment so the passage can keep it on one line.
const FILL_IN_BLANK = /(（\u3000）[。、]?)/u

/**
 * JLP-865: one block per source line, no blank lines between. Only prose
 * gets the 1em first-line indent: a line holding '。' that does not open
 * with a list mark (headings, addressees, signatures and list rows do not).
 */
export const passageParagraphs = (
  passage: string
): readonly PassageParagraph[] =>
  passage
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text) => ({
      text,
      indent: text.includes('。') && !NO_INDENT_START.test(text),
      segments: text.split(FILL_IN_BLANK)
    }))

export type PassageParagraph = {
  readonly text: string
  readonly indent: boolean
}

// A line that opens with a list mark, a bracket or a number is part of a
// notice or a list, so it sits on the left line with no indent. A line the
// source already indents with a full-width space keeps that space instead.
const NO_INDENT_START = /^[\u3000■・●○※【(（0-9０-９\u2460-\u2473]/u

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
    .map((line) => line.trimEnd().replace(/^[ \t]+/u, ''))
    .filter((line) => line.trim().length > 0)
    .map((text) => ({
      text,
      indent: text.includes('。') && !NO_INDENT_START.test(text)
    }))

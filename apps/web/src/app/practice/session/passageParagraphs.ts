export type PassageParagraph = {
  readonly text: string
  readonly indent: boolean
  /** #1182: code point where `text` starts in the passage as sent. */
  readonly start: number
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
): readonly PassageParagraph[] => {
  const paragraphs: PassageParagraph[] = []
  let lineStart = 0
  for (const line of passage.split('\n')) {
    const lineLength = Array.from(line).length
    const text = line.trimEnd().replace(/^[ \t]+/u, '')
    if (text.trim().length > 0) {
      paragraphs.push({
        text,
        indent: text.includes('。') && !NO_INDENT_START.test(text),
        // Only half-width spaces and tabs are cut from the front.
        start: lineStart + (/^[ \t]*/u.exec(line)?.[0].length ?? 0)
      })
    }
    lineStart += lineLength + 1
  }
  return paragraphs
}

import { ManuscriptSheet } from '@common/components/manuscript/ManuscriptSheet'
import type { CSSProperties, ReactElement } from 'react'
import { writeInStepMs } from '@app/home/dailyWriteIn'

/** Up to three rows of manuscript squares; longer questions stay plain text. */
const SHEET_MAX_ROWS = 3

// A run of ＿ is one blank; it is shortened before spaces go, so blanks
// written side by side stay apart.
export const sheetCharacters = (text: string): string[] =>
  Array.from(text.replace(/＿+/gu, '＿').replace(/\s+/gu, ''))

/**
 * One character per square (B4 §3); spaces between words are dropped and
 * each blank takes one square.
 * #997: while `writing`, the squares fill in order like a pen passing.
 */
export const QuestionSheet = ({
  text,
  writing
}: {
  text: string
  writing: boolean
}): ReactElement => {
  const characters = sheetCharacters(text)
  const sheetStyle = writing
    ? ({ '--step': `${writeInStepMs(characters.length)}ms` } as CSSProperties)
    : undefined
  const sheet = (columns: number, className: string): ReactElement | null => {
    const rows = Math.max(2, Math.ceil(characters.length / columns))
    if (rows > SHEET_MAX_ROWS) return null
    return (
      <ManuscriptSheet
        className={writing ? `${className} home-daily-write` : className}
        style={sheetStyle}
        columns={columns}
        rows={rows}
        renderCell={(cell) =>
          characters[cell.index] ? (
            <text
              className="home-daily-char"
              style={
                writing ? ({ '--i': cell.index } as CSSProperties) : undefined
              }
              x={cell.x + cell.c / 2}
              y={cell.y + cell.c / 2}
            >
              {characters[cell.index]}
            </text>
          ) : null
        }
      />
    )
  }
  const wide = sheet(15, 'home-daily-sheet home-daily-sheet-wide')
  const narrow = sheet(12, 'home-daily-sheet home-daily-sheet-narrow')
  // The sheets are hidden from screen readers; this sentence is read once.
  // #1036: with only the wide sheet, it shows only where that sheet does not.
  const sentenceClass =
    wide && narrow
      ? 'sr-only'
      : wide
        ? 'home-daily-question home-daily-question-narrow'
        : 'home-daily-question'
  return (
    <>
      {wide}
      {narrow}
      <p className={sentenceClass} lang="ja">
        {text}
      </p>
    </>
  )
}

import type { ReactElement, ReactNode } from 'react'
import { ManuscriptSheet } from '@common/components/manuscript/ManuscriptSheet'

/**
 * Blank manuscript paper for an empty list (B4 §3): ten by four with the
 * centre band before the second row, a word from the second square of the
 * first row. Decorative; the message beside it says why it is empty.
 */
export const EmptySheet = ({
  word,
  children
}: {
  readonly word: string
  readonly children: ReactNode
}): ReactElement => {
  const characters = Array.from(word)
  return (
    <div className="empty-sheet-layout">
      <ManuscriptSheet
        className="empty-sheet"
        columns={10}
        rows={4}
        bandBeforeRow={1}
        renderCell={(cell) => {
          const character = cell.index >= 1 ? characters[cell.index - 1] : null
          return character ? (
            <text
              className="empty-sheet-char"
              x={cell.x + cell.c / 2}
              y={cell.y + cell.c / 2}
            >
              {character}
            </text>
          ) : null
        }}
      />
      <div className="empty-sheet-message">{children}</div>
    </div>
  )
}

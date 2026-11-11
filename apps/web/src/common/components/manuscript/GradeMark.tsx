import type { CSSProperties, ReactElement } from 'react'
import type { SheetCell } from '@common/components/manuscript/ManuscriptSheet'

export type Grade = 'ok' | 'ng' | 'skip'

type GradeMarkProps = {
  readonly cell: Pick<SheetCell, 'x' | 'y' | 'c'>
  readonly grade: Grade
  /** Red-pen delay in ms; omit to show the finished mark. */
  readonly delayMs?: number
}

const delay = (delayMs: number | undefined): CSSProperties | undefined =>
  delayMs === undefined ? undefined : { animationDelay: `${delayMs}ms` }

/**
 * Correct: an ink circle from 12 o'clock. Wrong: a pale fill and a red
 * slash. Unanswered: a short grey dash. Shape and colour all differ. No vector-effect here: it breaks the
 * pathLength drawing.
 */
export const GradeMark = ({
  cell: { x, y, c },
  grade,
  delayMs
}: GradeMarkProps): ReactElement => {
  const cx = x + c / 2
  const cy = y + c / 2
  const animated = delayMs !== undefined
  if (grade === 'ok') {
    const r = 0.3 * c
    return (
      <path
        className={animated ? 'grade-ok manuscript-pen' : 'grade-ok'}
        style={delay(delayMs)}
        pathLength={1}
        d={`M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`}
      />
    )
  }
  if (grade === 'skip') {
    const half = 0.2 * c
    return (
      <path
        className={animated ? 'grade-skip manuscript-pen' : 'grade-skip'}
        style={delay(delayMs)}
        pathLength={1}
        d={`M${cx - half} ${cy}H${cx + half}`}
      />
    )
  }
  return (
    <g>
      <rect
        className={animated ? 'grade-ng-fill manuscript-fill' : 'grade-ng-fill'}
        style={delay(delayMs)}
        x={x + 1}
        y={y + 1}
        width={c - 2}
        height={c - 2}
      />
      <path
        className={animated ? 'grade-ng manuscript-pen' : 'grade-ng'}
        style={delay(delayMs)}
        pathLength={1}
        d={`M${cx - 0.28 * c} ${cy + 0.3 * c}L${cx + 0.3 * c} ${cy - 0.32 * c}`}
      />
    </g>
  )
}

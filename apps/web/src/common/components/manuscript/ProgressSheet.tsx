import type { ReactElement } from 'react'
import { ManuscriptSheet } from '@common/components/manuscript/ManuscriptSheet'
import { GradeMark } from '@common/components/manuscript/GradeMark'

/** todo: number only. current: ink box. answered: ink dot. ok/ng: graded. */
export type ProgressCellState = 'todo' | 'current' | 'answered' | 'ok' | 'ng'

type ProgressSheetProps = {
  readonly states: readonly ProgressCellState[]
  /** Play the red pen once (result screen). Reduced motion shows the end. */
  readonly animate?: boolean
  readonly className?: string
}

/** First mark at 150ms, then one every 100ms; each takes 180ms. */
export const gradeDelayMs = (index: number): number => 150 + 100 * index

/** Always ten squares wide; a shorter set leaves the rest blank. */
const MIN_COLUMNS = 10

/** The 10 × 1 progress strip. Decorative: the page states progress in text. */
export const ProgressSheet = ({
  states,
  animate = false,
  className
}: ProgressSheetProps): ReactElement => (
  <ManuscriptSheet
    className={['progress-sheet', className].filter(Boolean).join(' ')}
    columns={Math.max(MIN_COLUMNS, states.length)}
    rows={1}
    renderCell={(cell) => {
      const state = states[cell.index]
      if (state === undefined) return null
      const cx = cell.x + cell.c / 2
      const cy = cell.y + cell.c / 2
      if (state === 'ok' || state === 'ng') {
        return (
          <GradeMark
            cell={cell}
            grade={state}
            delayMs={animate ? gradeDelayMs(cell.index) : undefined}
          />
        )
      }
      if (state === 'answered') {
        return <circle className="progress-sheet-dot" cx={cx} cy={cy} r={3.2} />
      }
      return (
        <>
          {state === 'current' ? (
            <rect
              className="progress-sheet-current"
              x={cell.x + 3}
              y={cell.y + 3}
              width={cell.c - 6}
              height={cell.c - 6}
            />
          ) : null}
          <text
            className={
              state === 'current'
                ? 'progress-sheet-number is-current'
                : 'progress-sheet-number'
            }
            x={cx}
            y={cy}
          >
            {cell.index + 1}
          </text>
        </>
      )
    }}
  />
)

import type { ReactElement } from 'react'
import { ManuscriptSheet } from '@common/components/manuscript/ManuscriptSheet'
import { GradeMark } from '@common/components/manuscript/GradeMark'

/** todo: number only. current: ink box. answered: ink dot. ok/ng: graded. */
export type ProgressCellState = 'todo' | 'current' | 'answered' | 'ok' | 'ng'

/** Squares per row; a square is always a tenth of the sheet width. */
const ROW = 10

/**
 * Red-pen timing (B4 §5, §9): the first mark at 150ms, then one every 100ms
 * (50ms for sets over ten, so 20 ends with 10). Each mark takes 180ms; the
 * score circle starts 250ms after the last mark starts.
 */
export const gradeTiming = (total: number) => {
  const gap = total > ROW ? 50 : 100
  return {
    delayMs: (index: number): number => 150 + gap * index,
    scoreCircleMs: 150 + gap * Math.max(0, total - 1) + 250
  }
}

type ProgressSheetProps = {
  readonly states: readonly ProgressCellState[]
  /** Play the red pen once (result screen). Reduced motion shows the end. */
  readonly animate?: boolean
  /** Show only this ten-square row (phone solve screen, 11-20 of 20). */
  readonly rowOf?: number
  /** All squares in one row at this side (PC solve screen). */
  readonly singleRowCellSize?: number
  readonly className?: string
}

/** Decorative progress strip; the page states progress in text. */
export const ProgressSheet = ({
  states,
  animate = false,
  rowOf,
  singleRowCellSize,
  className
}: ProgressSheetProps): ReactElement => {
  const timing = gradeTiming(states.length)
  const start = rowOf === undefined ? 0 : Math.floor(rowOf / ROW) * ROW
  const shown =
    rowOf === undefined ? states.length : Math.min(ROW, states.length - start)
  const single = singleRowCellSize !== undefined
  return (
    <ManuscriptSheet
      className={['progress-sheet', className].filter(Boolean).join(' ')}
      columns={single ? states.length : ROW}
      rows={single ? 1 : Math.max(1, Math.ceil(shown / ROW))}
      cellSize={singleRowCellSize}
      count={shown}
      indexOffset={start}
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
              delayMs={animate ? timing.delayMs(cell.index) : undefined}
            />
          )
        }
        if (state === 'answered') {
          return (
            <circle className="progress-sheet-dot" cx={cx} cy={cy} r={3.2} />
          )
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
}

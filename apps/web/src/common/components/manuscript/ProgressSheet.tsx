import type { ReactElement } from 'react'
import { ManuscriptSheet } from '@common/components/manuscript/ManuscriptSheet'
import { GradeMark } from '@common/components/manuscript/GradeMark'

/**
 * todo: number only. current: ink box. answered: ink dot. ok/ng: graded.
 * skip: left unanswered, a grey dash (B4 §11).
 */
export type ProgressCellState =
  | 'todo'
  | 'current'
  | 'answered'
  | 'ok'
  | 'ng'
  | 'skip'

/**
 * Below this side a square drops its number; "13 / 20" says it (B4 §11).
 * JLP-869: under FULL_SIZE a two-digit number is set smaller and the current
 * box sits on the square's own rules, so "10" fits where "9" does. A current
 * square with no room for its number is filled instead of left empty.
 */
const MIN_NUMBERED = 17
const FULL_SIZE = 24

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
  /** All squares in one row, filling the width up to this side (PC solve). */
  readonly singleRowCellSize?: number
  /** One row of the shown squares filling the width, up to this side. */
  readonly maxCellSize?: number
  readonly className?: string
}

/** Decorative progress strip; the page states progress in text. */
export const ProgressSheet = ({
  states,
  animate = false,
  rowOf,
  singleRowCellSize,
  maxCellSize,
  className
}: ProgressSheetProps): ReactElement => {
  const timing = gradeTiming(states.length)
  const start = rowOf === undefined ? 0 : Math.floor(rowOf / ROW) * ROW
  const shown =
    rowOf === undefined ? states.length : Math.min(ROW, states.length - start)
  const single = singleRowCellSize !== undefined
  const fit = maxCellSize !== undefined
  return (
    <ManuscriptSheet
      className={['progress-sheet', className].filter(Boolean).join(' ')}
      columns={single ? states.length : fit ? Math.min(ROW, shown) : ROW}
      rows={single || fit ? 1 : Math.max(1, Math.ceil(shown / ROW))}
      maxCellSize={singleRowCellSize ?? maxCellSize}
      count={shown}
      indexOffset={start}
      renderCell={(cell) => {
        const state = states[cell.index]
        if (state === undefined) return null
        const cx = cell.x + cell.c / 2
        const cy = cell.y + cell.c / 2
        if (state === 'ok' || state === 'ng' || state === 'skip') {
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
        const isCurrent = state === 'current'
        const number = cell.index + 1
        const hasNumber = cell.c >= MIN_NUMBERED
        const inset = hasNumber && cell.c < FULL_SIZE ? 1 : 3
        return (
          <>
            {isCurrent ? (
              <rect
                className={
                  hasNumber
                    ? 'progress-sheet-current'
                    : 'progress-sheet-current is-filled'
                }
                x={cell.x + inset}
                y={cell.y + inset}
                width={cell.c - inset * 2}
                height={cell.c - inset * 2}
              />
            ) : null}
            {hasNumber ? (
              <text
                className={[
                  'progress-sheet-number',
                  isCurrent ? 'is-current' : '',
                  number >= 10 && cell.c < FULL_SIZE ? 'is-small' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                x={cx}
                y={cy}
              >
                {number}
              </text>
            ) : null}
          </>
        )
      }}
    />
  )
}

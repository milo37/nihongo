import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import manuscriptCss from '@common/components/manuscript/manuscript.css?inline'

/** One square's place in px: left, top and side. */
export type SheetCell = {
  readonly index: number
  readonly x: number
  readonly y: number
  readonly c: number
}

type ManuscriptSheetProps = {
  readonly columns: number
  readonly rows: number
  /** Width used before the first measurement (and in tests). */
  readonly fallbackWidth?: number
  /** Fixed square side; otherwise width ÷ columns. */
  readonly cellSize?: number
  /** Largest square side when it follows the width. */
  readonly maxCellSize?: number
  /** Index of the row that gets the centre band (판심) before it. */
  readonly bandBeforeRow?: number
  /** Squares drawn; the last row may be short (left aligned). */
  readonly count?: number
  /** Added to each cell index (a window into a longer strip). */
  readonly indexOffset?: number
  readonly renderCell?: (cell: SheetCell) => ReactNode
  readonly className?: string
  readonly style?: CSSProperties
}

/** Sheet and grade-mark styles; React hoists and dedupes them by href. */
export const ManuscriptStyles = (): ReactElement => (
  <style href="harumaru-manuscript" precedence="default">
    {manuscriptCss}
  </style>
)

/** Fish-tail marks (어미) at both ends of the centre band, 12 × 14. */
const TAIL_LEFT = 'M0 0H12V14H0L5 7Z'
const TAIL_RIGHT = 'M12 0H0V14H12L7 7Z'

/** Square cells with a blank strip between rows (cell : strip = 3 : 1). */
export const getSheetGeometry = (
  width: number,
  columns: number,
  rows: number,
  bandBeforeRow?: number,
  cellSize?: number,
  maxCellSize = Infinity
) => {
  const c = cellSize ?? Math.min(width / columns, maxCellSize)
  const b = Math.round(c / 3)
  const band = bandBeforeRow === undefined ? 0 : Math.round(0.8 * c) + b
  const rowTop = (row: number): number =>
    b +
    row * (c + b) +
    (bandBeforeRow !== undefined && row >= bandBeforeRow ? band : 0)
  const bandTop =
    bandBeforeRow === undefined ? null : b + bandBeforeRow * (c + b)
  return {
    c,
    b,
    band,
    bandTop,
    rowTop,
    width: c * columns,
    height: b + rows * (c + b) + band
  }
}

const useMeasuredWidth = (fallbackWidth: number) => {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallbackWidth)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const update = (): void => {
      const next = element.clientWidth
      if (next > 0) setWidth(next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/**
 * Manuscript paper (원고지) drawn at its real pixel width so 1px rules stay
 * 1px. Decorative: callers keep the same content as text for screen readers.
 */
export const ManuscriptSheet = ({
  columns,
  rows,
  fallbackWidth = 350,
  cellSize,
  maxCellSize,
  bandBeforeRow,
  count = columns * rows,
  indexOffset = 0,
  renderCell,
  className,
  style
}: ManuscriptSheetProps): ReactElement => {
  const [ref, measured] = useMeasuredWidth(fallbackWidth)
  const g = getSheetGeometry(
    measured,
    columns,
    rows,
    bandBeforeRow,
    cellSize,
    maxCellSize
  )
  const inRow = (row: number): number =>
    Math.max(0, Math.min(columns, count - row * columns))
  const cells: SheetCell[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < inRow(row); column += 1) {
      cells.push({
        index: indexOffset + row * columns + column,
        x: column * g.c,
        y: g.rowTop(row),
        c: g.c
      })
    }
  }

  return (
    <div
      ref={ref}
      className={['manuscript-sheet', className].filter(Boolean).join(' ')}
      style={style}
      aria-hidden="true"
    >
      <ManuscriptStyles />
      <svg
        width={g.width}
        height={g.height}
        viewBox={`0 0 ${g.width} ${g.height}`}
        focusable="false"
      >
        <g className="manuscript-sheet-rules">
          {Array.from({ length: rows }, (_, row) => {
            const top = g.rowTop(row)
            const squares = inRow(row)
            if (squares === 0) return null
            return (
              <g key={row}>
                <rect
                  x={0.5}
                  y={top + 0.5}
                  width={Math.round(squares * g.c) - 1}
                  height={g.c - 1}
                />
                {Array.from({ length: squares - 1 }, (_, column) => {
                  const x = Math.round((column + 1) * g.c) + 0.5
                  return (
                    <line key={column} x1={x} y1={top} x2={x} y2={top + g.c} />
                  )
                })}
              </g>
            )
          })}
          {g.bandTop === null ? null : (
            <g className="manuscript-sheet-band">
              <line
                x1={6 + 12}
                y1={g.bandTop + g.band / 2}
                x2={g.width - 6 - 12}
                y2={g.bandTop + g.band / 2}
                strokeDasharray="2 3"
              />
              <path
                className="manuscript-sheet-mark"
                d={TAIL_LEFT}
                transform={`translate(6 ${g.bandTop + g.band / 2 - 7})`}
              />
              <path
                className="manuscript-sheet-mark"
                d={TAIL_RIGHT}
                transform={`translate(${g.width - 18} ${g.bandTop + g.band / 2 - 7})`}
              />
            </g>
          )}
        </g>
        {renderCell
          ? cells.map((cell) => <g key={cell.index}>{renderCell(cell)}</g>)
          : null}
      </svg>
    </div>
  )
}

/** The fish-tail mark on its own, for header rules. */
export const SheetTail = ({
  side
}: {
  readonly side: 'left' | 'right'
}): ReactElement => (
  <svg
    className="manuscript-tail"
    width="12"
    height="14"
    viewBox="0 0 12 14"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d={side === 'left' ? TAIL_LEFT : TAIL_RIGHT}
      style={{ fill: 'rgb(var(--color-sheet-mark))' }}
    />
  </svg>
)

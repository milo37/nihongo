import type { ReactElement } from 'react'
import { GradeMark } from '@common/components/manuscript/GradeMark'
import type { Grade } from '@common/components/manuscript/GradeMark'
import { ManuscriptStyles } from '@common/components/manuscript/ManuscriptSheet'

const CELL = { x: 0, y: 0, c: 24 }

/**
 * One manuscript square holding a still grade mark (blank when ungraded).
 * Decorative: callers say correct or wrong in text.
 */
export const GradeSquare = ({
  grade,
  className,
  status
}: {
  readonly grade: Grade | null
  readonly className?: string
  /** Exposed as data-status for styles and tests. */
  readonly status?: string
}): ReactElement => (
  <>
    <ManuscriptStyles />
    <svg
      className={['grade-square', className].filter(Boolean).join(' ')}
      data-status={status}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {grade ? <GradeMark cell={CELL} grade={grade} /> : null}
      <rect
        className="grade-square-rule"
        x={0.5}
        y={0.5}
        width={23}
        height={23}
      />
    </svg>
  </>
)

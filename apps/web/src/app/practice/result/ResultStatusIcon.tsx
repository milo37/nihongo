import type { ReactElement } from 'react'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { GradeMark } from '@common/components/manuscript/GradeMark'
import { ManuscriptStyles } from '@common/components/manuscript/ManuscriptSheet'

export type ResultStatus = 'correct' | 'incorrect' | 'unanswered'

export const getResultStatus = (item: StudyResultItemView): ResultStatus =>
  item.isCorrect
    ? 'correct'
    : item.selectedOptionId === null
      ? 'unanswered'
      : 'incorrect'

const CELL = { x: 0, y: 0, c: 24 }

/**
 * One manuscript square: an ink circle (correct), a pale fill with a red
 * slash (incorrect) or left blank (unanswered). Never animated; the status
 * name is in text next to it.
 */
export const ResultStatusIcon = ({
  status
}: {
  status: ResultStatus
}): ReactElement => (
  <>
    <ManuscriptStyles />
    <svg
      className="result-status-icon"
      data-status={status}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {status === 'unanswered' ? null : (
        <GradeMark cell={CELL} grade={status === 'correct' ? 'ok' : 'ng'} />
      )}
      <rect
        className="result-status-icon-rule"
        x={0.5}
        y={0.5}
        width={23}
        height={23}
      />
    </svg>
  </>
)

import type { ReactElement } from 'react'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { Icon } from '@nihongo/browser/common/components/Icon'

export type ResultStatus = 'correct' | 'incorrect' | 'unanswered'

export const getResultStatus = (item: StudyResultItemView): ResultStatus =>
  item.isCorrect
    ? 'correct'
    : item.selectedOptionId === null
      ? 'unanswered'
      : 'incorrect'

const statusIcons = {
  correct: 'check',
  incorrect: 'x',
  unanswered: 'minus'
} as const

const statusClassNames: Record<ResultStatus, string> = {
  correct: 'bg-success text-on-accent',
  incorrect: 'bg-danger text-on-accent',
  unanswered: 'border border-dashed border-current text-muted'
}

/** Colour and shape (filled ✓, filled ✕, dashed –); the name is in text. */
export const ResultStatusIcon = ({
  status
}: {
  status: ResultStatus
}): ReactElement => (
  <span
    className={`result-status-icon inline-grid size-5 shrink-0 place-items-center rounded-full ${statusClassNames[status]}`}
    data-status={status}
  >
    <Icon name={statusIcons[status]} />
  </span>
)

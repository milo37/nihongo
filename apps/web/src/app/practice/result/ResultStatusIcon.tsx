import type { ReactElement } from 'react'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { GradeSquare } from '@common/components/manuscript/GradeSquare'

export type ResultStatus = 'correct' | 'incorrect' | 'unanswered'

export const getResultStatus = (item: StudyResultItemView): ResultStatus =>
  item.isCorrect
    ? 'correct'
    : item.selectedOptionId === null
      ? 'unanswered'
      : 'incorrect'

/** The B4 square mark: ○ correct, slash wrong, blank unanswered. */
export const ResultStatusIcon = ({
  status
}: {
  status: ResultStatus
}): ReactElement => (
  <GradeSquare
    className="result-status-icon"
    status={status}
    grade={status === 'correct' ? 'ok' : status === 'incorrect' ? 'ng' : null}
  />
)

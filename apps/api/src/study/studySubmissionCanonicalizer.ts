import { createHash } from 'node:crypto'
import { STUDY_SUBMISSION_CANONICAL_PREFIX } from '@nihongo/domain/submission/canonicalize-study-submission'
import type { SubmittedStudyAnswer } from '@nihongo/domain/grading/grade-study-submission'

export interface SubmissionQuestionOrder {
  readonly ordinal: number
  readonly studySessionQuestionId: string
}

export interface TolerantStudySubmissionInput {
  readonly answers: readonly SubmittedStudyAnswer[]
  readonly durationSec: number
  readonly orderedSessionQuestions: readonly SubmissionQuestionOrder[]
  readonly sessionId: string
}

const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1

export const canonicalizeTolerantStudySubmission = ({
  answers,
  durationSec,
  orderedSessionQuestions,
  sessionId
}: TolerantStudySubmissionInput): string => {
  const ordinalById = new Map(
    orderedSessionQuestions.map(({ ordinal, studySessionQuestionId }) => [
      studySessionQuestionId,
      ordinal
    ])
  )

  const normalizedAnswers = answers
    .map((answer) => ({
      studySessionQuestionId: answer.studySessionQuestionId,
      selectedOptionId: answer.selectedOptionId,
      elapsedSec: answer.elapsedSec
    }))
    .toSorted((left, right) => {
      const leftOrdinal = ordinalById.get(left.studySessionQuestionId)
      const rightOrdinal = ordinalById.get(right.studySessionQuestionId)

      if (leftOrdinal !== undefined && rightOrdinal !== undefined) {
        return (
          leftOrdinal - rightOrdinal ||
          compareText(left.studySessionQuestionId, right.studySessionQuestionId)
        )
      }
      if (leftOrdinal !== undefined) {
        return -1
      }
      if (rightOrdinal !== undefined) {
        return 1
      }
      return compareText(
        left.studySessionQuestionId,
        right.studySessionQuestionId
      )
    })

  return `${STUDY_SUBMISSION_CANONICAL_PREFIX}${JSON.stringify({
    sessionId,
    answers: normalizedAnswers,
    durationSec
  })}`
}

export const hashStudySubmission = (canonical: string): string =>
  createHash('sha256').update(canonical).digest('hex')

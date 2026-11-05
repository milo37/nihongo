export const STUDY_DRAFT_SAVE_CANONICAL_PREFIX = 'draft-save-v2:' as const

export interface OrderedDraftQuestion {
  readonly ordinal: number
  readonly studySessionQuestionId: string
}

interface StudyDraftSaveAnswer {
  readonly studySessionQuestionId: string
  readonly selectedOptionId: string | null
  readonly elapsedSec: number
}

interface StudyDraftSaveInput {
  readonly expectedRevision: number
  readonly currentOrdinal: number
  readonly answers: readonly StudyDraftSaveAnswer[]
}

/** Shared by the API (idempotency hash) and the browser (pending save key). */
export const canonicalizeStudyDraftSave = (
  sessionId: string,
  orderedQuestions: readonly OrderedDraftQuestion[],
  input: StudyDraftSaveInput
): string => {
  const ordinalById = new Map(
    orderedQuestions.map(({ ordinal, studySessionQuestionId }) => [
      studySessionQuestionId,
      ordinal
    ])
  )
  const answers = input.answers
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
          left.studySessionQuestionId.localeCompare(
            right.studySessionQuestionId
          )
        )
      }
      if (leftOrdinal !== undefined) {
        return -1
      }
      if (rightOrdinal !== undefined) {
        return 1
      }
      return left.studySessionQuestionId.localeCompare(
        right.studySessionQuestionId
      )
    })

  return `${STUDY_DRAFT_SAVE_CANONICAL_PREFIX}${JSON.stringify({
    sessionId,
    expectedRevision: input.expectedRevision,
    currentOrdinal: input.currentOrdinal,
    answers
  })}`
}

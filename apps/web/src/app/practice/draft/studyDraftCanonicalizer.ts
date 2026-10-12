import type { ParsedSaveStudyDraftAnswersRequest } from '@api/study/saveStudyDraftAnswers/schema'

export const STUDY_DRAFT_SAVE_CANONICAL_PREFIX = 'draft-save-v2:' as const

export const canonicalizeStudyDraftSave = (
  sessionId: string,
  orderedSessionQuestionIds: readonly string[],
  input: ParsedSaveStudyDraftAnswersRequest
): string => {
  const ordinalById = new Map(
    orderedSessionQuestionIds.map((questionId, index) => [
      questionId,
      index + 1
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

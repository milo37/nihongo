import type { ListReviewEventsResponse } from '@nihongo/contracts/wrong-note/list-review-events'

export interface WrongNotePreviousAnswerTarget {
  lastWrongQuestionVersionId: string | null
  lastWrongAt: string
  wrongCount: number
  optionIds: readonly string[]
}

export type WrongNotePreviousAnswer =
  | { status: 'selected'; optionId: string }
  | { status: 'unanswered' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'paused' }

export type WrongNotePreviousAnswerMatch =
  | { status: 'selected'; optionId: string }
  | { status: 'unanswered' }
  | { status: 'unavailable' }
  | { status: 'needsMore' }

export const matchWrongNotePreviousAnswer = (
  target: WrongNotePreviousAnswerTarget,
  pages: readonly ListReviewEventsResponse[]
): WrongNotePreviousAnswerMatch => {
  const lastWrongTime = Date.parse(target.lastWrongAt)
  if (!target.lastWrongQuestionVersionId || !Number.isFinite(lastWrongTime)) {
    return { status: 'unavailable' }
  }

  const matches = pages
    .flatMap((page) => page.items)
    .filter(
      (event) =>
        event.source !== 'VERSION_REBASE' &&
        event.isCorrect === false &&
        event.questionVersionId === target.lastWrongQuestionVersionId &&
        Date.parse(event.occurredAt) === lastWrongTime &&
        event.wrongCountAfter === target.wrongCount
    )
  if (matches.length > 1) return { status: 'unavailable' }
  const match = matches[0]
  if (match) {
    if (match.selectedOptionId === null) return { status: 'unanswered' }
    return target.optionIds.includes(match.selectedOptionId)
      ? { status: 'selected', optionId: match.selectedOptionId }
      : { status: 'unavailable' }
  }

  const lastPage = pages.at(-1)
  const oldestEvent = lastPage?.items.at(-1)
  if (
    lastPage?.nextCursor === null ||
    (oldestEvent && Date.parse(oldestEvent.occurredAt) < lastWrongTime)
  ) {
    return { status: 'unavailable' }
  }
  return { status: 'needsMore' }
}

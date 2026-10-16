import { describe, expect, it } from 'vitest'
import type {
  ReviewEventHistoryItem,
  ListReviewEventsResponse
} from '@nihongo/contracts/wrong-note/list-review-events'
import { matchWrongNotePreviousAnswer } from '@app/wrong-note/adapters/wrongNotePreviousAnswer'
import type { WrongNotePreviousAnswerTarget } from '@app/wrong-note/adapters/wrongNotePreviousAnswer'

const target: WrongNotePreviousAnswerTarget = {
  lastWrongQuestionVersionId: 'historical-version',
  lastWrongAt: '2026-10-16T09:00:00.000Z',
  wrongCount: 2,
  optionIds: ['wrong-option', 'correct-option']
}
const event = (
  overrides: Partial<ReviewEventHistoryItem> = {}
): ReviewEventHistoryItem => ({
  id: 'event',
  source: 'STUDY_SUBMIT',
  questionVersionId: 'historical-version',
  selectedOptionId: 'wrong-option',
  isCorrect: false,
  elapsedSec: 1,
  previousStatus: 'NEW',
  nextStatus: 'AGAIN',
  previousCorrectStreak: 0,
  nextCorrectStreak: 0,
  previousWrongCount: 1,
  wrongCountAfter: 2,
  algorithmVersion: 1,
  occurredAt: target.lastWrongAt,
  ...overrides
})
const page = (
  items: ReviewEventHistoryItem[],
  nextCursor: string | null = null
): ListReviewEventsResponse => ({ items, nextCursor })

describe('historical wrong-note answer matching', () => {
  it('identifies the owned historical option', () => {
    expect(matchWrongNotePreviousAnswer(target, [page([event()])])).toEqual({
      status: 'selected',
      optionId: 'wrong-option'
    })
  })
  it('distinguishes a confirmed unanswered event from absent history', () => {
    expect(
      matchWrongNotePreviousAnswer(target, [
        page([event({ selectedOptionId: null })])
      ])
    ).toEqual({ status: 'unanswered' })
    expect(matchWrongNotePreviousAnswer(target, [page([])])).toEqual({
      status: 'unavailable'
    })
  })
  it('uses wrong count to disambiguate simultaneous candidates', () => {
    expect(
      matchWrongNotePreviousAnswer(target, [
        page([
          event({
            id: 'another-count',
            wrongCountAfter: 3,
            selectedOptionId: null
          }),
          event()
        ])
      ])
    ).toEqual({ status: 'selected', optionId: 'wrong-option' })
  })
  it('does not substitute a later correct answer, rebase, version or time', () => {
    const unrelated = [
      event({
        id: 'correct',
        isCorrect: true,
        selectedOptionId: 'correct-option'
      }),
      event({
        id: 'rebase',
        source: 'VERSION_REBASE',
        isCorrect: null,
        selectedOptionId: null
      }),
      event({ id: 'other-version', questionVersionId: 'current-version' }),
      event({ id: 'other-time', occurredAt: '2026-10-16T09:00:01.000Z' })
    ]
    expect(matchWrongNotePreviousAnswer(target, [page(unrelated)])).toEqual({
      status: 'unavailable'
    })
  })
  it('rejects an option outside the historical question', () => {
    expect(
      matchWrongNotePreviousAnswer(target, [
        page([event({ selectedOptionId: 'foreign-option' })])
      ])
    ).toEqual({ status: 'unavailable' })
  })
  it('requests a cursor only while the target time can still occur', () => {
    const recent = page(
      [event({ occurredAt: '2026-10-16T09:01:00.000Z' })],
      'older'
    )
    expect(matchWrongNotePreviousAnswer(target, [recent])).toEqual({
      status: 'needsMore'
    })
    expect(
      matchWrongNotePreviousAnswer(target, [
        recent,
        page([event()], 'unused-older')
      ])
    ).toEqual({ status: 'selected', optionId: 'wrong-option' })
    expect(
      matchWrongNotePreviousAnswer(target, [
        page([event({ occurredAt: '2026-10-16T08:59:59.000Z' })], 'unneeded')
      ])
    ).toEqual({ status: 'unavailable' })
  })
  it('continues across a page boundary within the same timestamp', () => {
    expect(
      matchWrongNotePreviousAnswer(target, [
        page([event({ wrongCountAfter: 3 })], 'same-time')
      ])
    ).toEqual({ status: 'needsMore' })
  })
  it('matches the same instant with another valid timezone representation', () => {
    expect(
      matchWrongNotePreviousAnswer(target, [
        page([event({ occurredAt: '2026-10-16T18:00:00.000+09:00' })])
      ])
    ).toEqual({ status: 'selected', optionId: 'wrong-option' })
  })
  it('does not guess for a missing version or duplicate exact candidates', () => {
    expect(
      matchWrongNotePreviousAnswer(
        { ...target, lastWrongQuestionVersionId: null },
        []
      )
    ).toEqual({ status: 'unavailable' })
    expect(
      matchWrongNotePreviousAnswer(target, [
        page([event(), event({ id: 'duplicate' })])
      ])
    ).toEqual({ status: 'unavailable' })
  })
})

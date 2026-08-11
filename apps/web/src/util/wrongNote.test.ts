import { describe, expect, it } from 'vitest'
import {
  createWrongNoteFromIncorrectAnswer,
  updateWrongNoteAfterCorrectReview,
  updateWrongNoteAfterIncorrectAnswer
} from '@util/wrongNote'

const FIRST_WRONG_AT = '2026-08-01T00:00:00.000Z'
const FIRST_REVIEW_AT = '2026-08-02T00:00:00.000Z'
const SECOND_REVIEW_AT = '2026-08-03T00:00:00.000Z'

describe('wrongNote 상태 머신', () => {
  it('첫 오답을 NEW로 만든다', () => {
    const note = createWrongNoteFromIncorrectAnswer(
      'demo-user',
      'question-1',
      FIRST_WRONG_AT
    )

    expect(note).toMatchObject({
      wrongCount: 1,
      correctStreak: 0,
      status: 'NEW',
      lastWrongAt: FIRST_WRONG_AT,
      lastReviewedAt: null
    })
  })

  it('NEW 정답은 REVIEWING, 연속 두 번째 정답은 SOLVED로 바꾼다', () => {
    const created = createWrongNoteFromIncorrectAnswer(
      'demo-user',
      'question-1',
      FIRST_WRONG_AT
    )
    const reviewing = updateWrongNoteAfterCorrectReview(
      created,
      FIRST_REVIEW_AT
    )
    const solved = updateWrongNoteAfterCorrectReview(
      reviewing,
      SECOND_REVIEW_AT
    )

    expect(reviewing).toMatchObject({
      wrongCount: 1,
      correctStreak: 1,
      status: 'REVIEWING'
    })
    expect(solved).toMatchObject({
      wrongCount: 1,
      correctStreak: 2,
      status: 'SOLVED',
      nextReviewAt: null
    })
  })

  it('REVIEWING 오답은 AGAIN으로 바꾸고 횟수와 streak를 갱신한다', () => {
    const created = createWrongNoteFromIncorrectAnswer(
      'demo-user',
      'question-1',
      FIRST_WRONG_AT
    )
    const reviewing = updateWrongNoteAfterCorrectReview(
      created,
      FIRST_REVIEW_AT
    )
    const again = updateWrongNoteAfterIncorrectAnswer(
      reviewing,
      SECOND_REVIEW_AT
    )

    expect(again).toMatchObject({
      wrongCount: 2,
      correctStreak: 0,
      status: 'AGAIN',
      lastWrongAt: SECOND_REVIEW_AT,
      lastReviewedAt: SECOND_REVIEW_AT
    })
  })

  it('SOLVED 문제를 다시 틀리면 AGAIN으로 되돌린다', () => {
    const created = createWrongNoteFromIncorrectAnswer(
      'demo-user',
      'question-1',
      FIRST_WRONG_AT
    )
    const reviewing = updateWrongNoteAfterCorrectReview(
      created,
      FIRST_REVIEW_AT
    )
    const solved = updateWrongNoteAfterCorrectReview(
      reviewing,
      SECOND_REVIEW_AT
    )
    const again = updateWrongNoteAfterIncorrectAnswer(
      solved,
      '2026-08-04T00:00:00.000Z'
    )

    expect(again).toMatchObject({
      wrongCount: 2,
      correctStreak: 0,
      status: 'AGAIN'
    })
  })
})

import { describe, expect, it } from 'vitest'
import {
  applyWrongNoteReview,
  assertUniqueReviewEventEvidence,
  WRONG_NOTE_ALGORITHM_VERSION,
  WrongNoteReviewError,
  type WrongNoteReviewDecision,
  type WrongNoteReviewState
} from '../src/review/apply-wrong-note-review.js'

const FIRST_WRONG_AT = new Date('2026-08-01T00:00:00.000Z')
const FIRST_REVIEW_AT = new Date('2026-08-02T00:00:00.000Z')

const requireDecision = (
  decision: WrongNoteReviewDecision | null
): WrongNoteReviewDecision => {
  if (decision === null) {
    throw new Error('WrongNote review decision이 필요합니다.')
  }
  return decision
}

const expectReviewCode = (
  action: () => unknown,
  code: WrongNoteReviewError['code']
): void => {
  try {
    action()
    throw new Error(`WrongNoteReviewError ${code}가 필요합니다.`)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(WrongNoteReviewError)
    expect((error as WrongNoteReviewError).code).toBe(code)
  }
}

describe('applyWrongNoteReview algorithm v1', () => {
  it('기존 note 없는 최초 정답에는 note와 event를 만들지 않는다', () => {
    expect(
      applyWrongNoteReview({
        previous: null,
        isCorrect: true,
        occurredAt: FIRST_WRONG_AT
      })
    ).toBeNull()
  })

  it('첫 오답을 NEW와 +1일 schedule, null previous event로 만든다', () => {
    const decision = requireDecision(
      applyWrongNoteReview({
        previous: null,
        isCorrect: false,
        occurredAt: FIRST_WRONG_AT
      })
    )

    expect(decision.wrongNote).toEqual({
      wrongCount: 1,
      correctStreak: 0,
      status: 'NEW',
      lastWrongAt: FIRST_WRONG_AT,
      lastReviewedAt: null
    })
    expect(decision.schedule).toEqual({
      nextReviewAt: new Date('2026-08-02T00:00:00.000Z'),
      intervalDays: 1,
      algorithmVersion: WRONG_NOTE_ALGORITHM_VERSION
    })
    expect(decision.event).toMatchObject({
      isCorrect: false,
      previousStatus: null,
      nextStatus: 'NEW',
      previousCorrectStreak: null,
      nextCorrectStreak: 0,
      previousWrongCount: null,
      wrongCountAfter: 1,
      algorithmVersion: WRONG_NOTE_ALGORITHM_VERSION
    })
  })

  it('정답 streak 1·2·3·4의 REVIEWING/SOLVED 간격을 고정한다', () => {
    const created = requireDecision(
      applyWrongNoteReview({
        previous: null,
        isCorrect: false,
        occurredAt: FIRST_WRONG_AT
      })
    ).wrongNote
    const reviewing = requireDecision(
      applyWrongNoteReview({
        previous: created,
        isCorrect: true,
        occurredAt: FIRST_REVIEW_AT
      })
    )
    const solved = requireDecision(
      applyWrongNoteReview({
        previous: reviewing.wrongNote,
        isCorrect: true,
        occurredAt: new Date('2026-08-05T00:00:00.000Z')
      })
    )
    const streakThree = requireDecision(
      applyWrongNoteReview({
        previous: solved.wrongNote,
        isCorrect: true,
        occurredAt: new Date('2026-08-12T00:00:00.000Z')
      })
    )
    const streakFour = requireDecision(
      applyWrongNoteReview({
        previous: streakThree.wrongNote,
        isCorrect: true,
        occurredAt: new Date('2026-08-26T00:00:00.000Z')
      })
    )

    expect(reviewing.wrongNote).toMatchObject({
      status: 'REVIEWING',
      correctStreak: 1,
      wrongCount: 1
    })
    expect(reviewing.schedule.intervalDays).toBe(3)
    expect(solved.wrongNote).toMatchObject({
      status: 'SOLVED',
      correctStreak: 2
    })
    expect(solved.schedule.intervalDays).toBe(7)
    expect(streakThree.schedule.intervalDays).toBe(14)
    expect(streakFour.schedule.intervalDays).toBe(30)
    expect(streakFour.schedule.nextReviewAt).toEqual(
      new Date('2026-09-25T00:00:00.000Z')
    )
  })

  it.each(['NEW', 'REVIEWING', 'AGAIN', 'SOLVED'] as const)(
    '%s 상태의 오답을 AGAIN +1일로 전이한다',
    (status) => {
      const previousByStatus: Record<typeof status, WrongNoteReviewState> = {
        NEW: {
          wrongCount: 1,
          correctStreak: 0,
          status: 'NEW',
          lastWrongAt: FIRST_WRONG_AT,
          lastReviewedAt: null
        },
        REVIEWING: {
          wrongCount: 1,
          correctStreak: 1,
          status: 'REVIEWING',
          lastWrongAt: FIRST_WRONG_AT,
          lastReviewedAt: FIRST_REVIEW_AT
        },
        AGAIN: {
          wrongCount: 2,
          correctStreak: 0,
          status: 'AGAIN',
          lastWrongAt: FIRST_REVIEW_AT,
          lastReviewedAt: FIRST_REVIEW_AT
        },
        SOLVED: {
          wrongCount: 1,
          correctStreak: 2,
          status: 'SOLVED',
          lastWrongAt: FIRST_WRONG_AT,
          lastReviewedAt: FIRST_REVIEW_AT
        }
      }
      const occurredAt = new Date('2026-08-10T00:00:00.000Z')
      const previous = previousByStatus[status]
      const decision = requireDecision(
        applyWrongNoteReview({ previous, isCorrect: false, occurredAt })
      )

      expect(decision.wrongNote).toEqual({
        wrongCount: previous.wrongCount + 1,
        correctStreak: 0,
        status: 'AGAIN',
        lastWrongAt: occurredAt,
        lastReviewedAt: occurredAt
      })
      expect(decision.schedule.intervalDays).toBe(1)
      expect(decision.event).toMatchObject({
        previousStatus: status,
        nextStatus: 'AGAIN',
        previousCorrectStreak: previous.correctStreak,
        nextCorrectStreak: 0,
        previousWrongCount: previous.wrongCount,
        wrongCountAfter: previous.wrongCount + 1
      })
    }
  )

  it('입력 Date를 변경하지 않고 output Date 참조를 분리한다', () => {
    const occurredAt = new Date(FIRST_WRONG_AT)
    const before = occurredAt.getTime()
    const decision = requireDecision(
      applyWrongNoteReview({ previous: null, isCorrect: false, occurredAt })
    )

    decision.wrongNote.lastWrongAt.setUTCFullYear(2030)
    expect(occurredAt.getTime()).toBe(before)
    expect(decision.event.occurredAt).toEqual(FIRST_WRONG_AT)
  })

  it('불가능한 previous state와 역행 clock을 거부한다', () => {
    const invalid: WrongNoteReviewState = {
      wrongCount: 1,
      correctStreak: 2,
      status: 'NEW',
      lastWrongAt: FIRST_WRONG_AT,
      lastReviewedAt: null
    }
    expectReviewCode(
      () =>
        applyWrongNoteReview({
          previous: invalid,
          isCorrect: true,
          occurredAt: FIRST_REVIEW_AT
        }),
      'INVALID_PREVIOUS_STATE'
    )

    const valid: WrongNoteReviewState = {
      wrongCount: 1,
      correctStreak: 0,
      status: 'NEW',
      lastWrongAt: FIRST_REVIEW_AT,
      lastReviewedAt: null
    }
    expectReviewCode(
      () =>
        applyWrongNoteReview({
          previous: valid,
          isCorrect: true,
          occurredAt: FIRST_WRONG_AT
        }),
      'NON_MONOTONIC_OCCURRED_AT'
    )
  })

  it('같은 StudyAnswer evidence 중복을 거부한다', () => {
    expect(() =>
      assertUniqueReviewEventEvidence([
        { studyAnswerId: 'answer-1' },
        { studyAnswerId: null },
        { studyAnswerId: 'answer-2' }
      ])
    ).not.toThrow()
    expectReviewCode(
      () =>
        assertUniqueReviewEventEvidence([
          { studyAnswerId: 'answer-1' },
          { studyAnswerId: 'answer-1' }
        ]),
      'DUPLICATE_EVIDENCE'
    )
  })
})

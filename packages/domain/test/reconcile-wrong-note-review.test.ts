import { describe, expect, it } from 'vitest'
import type {
  ReviewReconciliationEvent,
  ReviewReconciliationSchedule
} from '../src/review/reconcile-wrong-note-review.js'
import { reconcileWrongNoteReview } from '../src/review/reconcile-wrong-note-review.js'

const firstOccurredAt = new Date('2026-08-01T00:00:00.000Z')
const secondOccurredAt = new Date('2026-08-02T00:00:00.000Z')

const firstWrongEvent: ReviewReconciliationEvent = {
  algorithmVersion: 1,
  evidenceValid: true,
  isCorrect: false,
  nextCorrectStreak: 0,
  nextStatus: 'NEW',
  occurredAt: firstOccurredAt,
  previousCorrectStreak: null,
  previousStatus: null,
  previousWrongCount: null,
  questionVersionId: '550e8400-e29b-41d4-a716-446655440001',
  source: 'STUDY_SUBMIT',
  sourceModeValid: true,
  wrongCountAfter: 1
}

const secondWrongEvent: ReviewReconciliationEvent = {
  algorithmVersion: 1,
  evidenceValid: true,
  isCorrect: false,
  nextCorrectStreak: 0,
  nextStatus: 'AGAIN',
  occurredAt: secondOccurredAt,
  previousCorrectStreak: 0,
  previousStatus: 'NEW',
  previousWrongCount: 1,
  questionVersionId: '550e8400-e29b-41d4-a716-446655440002',
  source: 'WRONG_NOTE_REVIEW',
  sourceModeValid: true,
  wrongCountAfter: 2
}

const schedule: ReviewReconciliationSchedule = {
  algorithmVersion: 1,
  intervalDays: 1,
  nextReviewAt: new Date('2026-08-03T00:00:00.000Z'),
  updatedAt: secondOccurredAt
}

describe('wrong-note review reconciliation', () => {
  it('algorithm v1 event chain, materialized note와 schedule이 일치하면 mismatch가 없다', () => {
    expect(
      reconcileWrongNoteReview({
        events: [firstWrongEvent, secondWrongEvent],
        materializedWrongNote: {
          wrongCount: 2,
          correctStreak: 0,
          status: 'AGAIN',
          lastWrongAt: secondOccurredAt,
          lastReviewedAt: secondOccurredAt,
          lastWrongQuestionVersionId: secondWrongEvent.questionVersionId,
          updatedAt: secondOccurredAt
        },
        schedule
      })
    ).toEqual({
      mismatchCategories: [],
      oldestMismatchOccurredAtByCategory: {}
    })
  })

  it('chain, materialized state와 schedule drift를 독립 category로 보고한다', () => {
    const result = reconcileWrongNoteReview({
      events: [
        firstWrongEvent,
        { ...secondWrongEvent, previousWrongCount: 9, wrongCountAfter: 3 }
      ],
      materializedWrongNote: {
        wrongCount: 9,
        correctStreak: 0,
        status: 'AGAIN',
        lastWrongAt: secondOccurredAt,
        lastReviewedAt: secondOccurredAt,
        lastWrongQuestionVersionId: secondWrongEvent.questionVersionId,
        updatedAt: secondOccurredAt
      },
      schedule: { ...schedule, intervalDays: 7 }
    })

    expect(result.mismatchCategories).toEqual([
      'EVENT_CHAIN',
      'MATERIALIZED_WRONG_NOTE',
      'REVIEW_SCHEDULE'
    ])
    expect(result.oldestMismatchOccurredAtByCategory).toEqual({
      EVENT_CHAIN: secondOccurredAt,
      MATERIALIZED_WRONG_NOTE: secondOccurredAt,
      REVIEW_SCHEDULE: secondOccurredAt
    })
  })

  it('evidence pin과 source/mode mismatch를 payload 없이 분류한다', () => {
    const result = reconcileWrongNoteReview({
      events: [
        { ...firstWrongEvent, evidenceValid: false, sourceModeValid: false }
      ],
      materializedWrongNote: {
        wrongCount: 1,
        correctStreak: 0,
        status: 'NEW',
        lastWrongAt: firstOccurredAt,
        lastReviewedAt: null,
        lastWrongQuestionVersionId: firstWrongEvent.questionVersionId,
        updatedAt: firstOccurredAt
      },
      schedule: {
        algorithmVersion: 1,
        intervalDays: 1,
        nextReviewAt: secondOccurredAt,
        updatedAt: firstOccurredAt
      }
    })

    expect(result.mismatchCategories).toEqual(['EVIDENCE_PIN', 'SOURCE_MODE'])
  })

  it('event snapshot drift가 있어도 canonical transition으로 후속 materialized state를 판정한다', () => {
    const result = reconcileWrongNoteReview({
      events: [{ ...firstWrongEvent, algorithmVersion: 999 }],
      materializedWrongNote: {
        wrongCount: 1,
        correctStreak: 0,
        status: 'NEW',
        lastWrongAt: firstOccurredAt,
        lastReviewedAt: null,
        lastWrongQuestionVersionId: firstWrongEvent.questionVersionId,
        updatedAt: firstOccurredAt
      },
      schedule: {
        algorithmVersion: 1,
        intervalDays: 1,
        nextReviewAt: secondOccurredAt,
        updatedAt: firstOccurredAt
      }
    })

    expect(result.mismatchCategories).toEqual(['EVENT_CHAIN'])
  })

  it('VERSION_REBASE는 state를 보존할 때만 허용한다', () => {
    const validRebase: ReviewReconciliationEvent = {
      ...secondWrongEvent,
      isCorrect: null,
      nextStatus: 'NEW',
      previousStatus: 'NEW',
      previousWrongCount: 1,
      source: 'VERSION_REBASE',
      wrongCountAfter: 1
    }
    const materialized = {
      wrongCount: 1,
      correctStreak: 0,
      status: 'NEW' as const,
      lastWrongAt: firstOccurredAt,
      lastReviewedAt: null,
      lastWrongQuestionVersionId: firstWrongEvent.questionVersionId,
      updatedAt: firstOccurredAt
    }
    const firstSchedule = {
      algorithmVersion: 1,
      intervalDays: 1,
      nextReviewAt: secondOccurredAt,
      updatedAt: firstOccurredAt
    }

    expect(
      reconcileWrongNoteReview({
        events: [firstWrongEvent, validRebase],
        materializedWrongNote: materialized,
        schedule: firstSchedule
      }).mismatchCategories
    ).toEqual([])
    expect(
      reconcileWrongNoteReview({
        events: [
          firstWrongEvent,
          { ...validRebase, nextCorrectStreak: 2, nextStatus: 'SOLVED' }
        ],
        materializedWrongNote: materialized,
        schedule: firstSchedule
      }).mismatchCategories
    ).toContain('EVENT_CHAIN')
    expect(
      reconcileWrongNoteReview({
        events: [firstWrongEvent, { ...validRebase, algorithmVersion: 999 }],
        materializedWrongNote: materialized,
        schedule: firstSchedule
      }).mismatchCategories
    ).toContain('EVENT_CHAIN')
  })
})

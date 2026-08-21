import { describe, expect, it } from 'vitest'
import {
  assertPracticeCompatibilityFacts,
  PracticeCompatibilityFenceError,
  type PracticeCompatibilityFacts
} from './practiceCompatibilityFence.js'

const emptyFacts: PracticeCompatibilityFacts = {
  bookmarkCount: 0,
  v2StudySessionCount: 0,
  studyDraftCount: 0,
  studyDraftAnswerCount: 0,
  currentReviewWrongNoteCount: 0,
  retryRelationCount: 0,
  v2IdempotencyRecordCount: 0
}

describe('practice compatibility fence', () => {
  it('모든 v2 fact가 0일 때만 compatibility listener를 허용한다', () => {
    expect(() => assertPracticeCompatibilityFacts(emptyFacts)).not.toThrow()

    for (const field of Object.keys(emptyFacts) as Array<
      keyof PracticeCompatibilityFacts
    >) {
      expect(() =>
        assertPracticeCompatibilityFacts({ ...emptyFacts, [field]: 1 })
      ).toThrow(PracticeCompatibilityFenceError)
    }
  })
})

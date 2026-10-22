import { describe, expect, it } from 'vitest'
import {
  canonicalizeStudyDraftSave,
  hashStudyDraftSave
} from './studyDraftCanonicalizer.js'

const SESSION_ID = '00000000-0000-4000-8000-000000000001'
const QUESTION_1 = '00000000-0000-4000-8000-000000000002'
const QUESTION_2 = '00000000-0000-4000-8000-000000000003'
const OPTION_1 = '00000000-0000-4000-8000-000000000004'
const OPTION_2 = '00000000-0000-4000-8000-000000000005'
const questions = [
  { ordinal: 1, studySessionQuestionId: QUESTION_1 },
  { ordinal: 2, studySessionQuestionId: QUESTION_2 }
] as const

describe('study draft canonicalizer', () => {
  it('입력 answer 순서와 무관하게 ordinal 순 canonical material과 hash를 만든다', () => {
    const first = canonicalizeStudyDraftSave(SESSION_ID, questions, {
      expectedRevision: 0,
      currentOrdinal: 2,
      answers: [
        {
          studySessionQuestionId: QUESTION_2,
          selectedOptionId: null,
          elapsedSec: 12
        },
        {
          studySessionQuestionId: QUESTION_1,
          selectedOptionId: OPTION_1,
          elapsedSec: 8
        }
      ]
    })
    const second = canonicalizeStudyDraftSave(SESSION_ID, questions, {
      expectedRevision: 0,
      currentOrdinal: 2,
      answers: [
        {
          studySessionQuestionId: QUESTION_1,
          selectedOptionId: OPTION_1,
          elapsedSec: 8
        },
        {
          studySessionQuestionId: QUESTION_2,
          selectedOptionId: null,
          elapsedSec: 12
        }
      ]
    })

    expect(second).toBe(first)
    expect(hashStudyDraftSave(second)).toBe(hashStudyDraftSave(first))
  })

  it('session, revision, ordinal, selection, elapsed 변경을 모두 hash에 반영한다', () => {
    const answerOne = {
      studySessionQuestionId: QUESTION_1,
      selectedOptionId: OPTION_1,
      elapsedSec: 8
    }
    const answerTwo = {
      studySessionQuestionId: QUESTION_2,
      selectedOptionId: null,
      elapsedSec: 12
    }
    const base = {
      expectedRevision: 0,
      currentOrdinal: 1,
      answers: [answerOne, answerTwo]
    }
    const baseline = hashStudyDraftSave(
      canonicalizeStudyDraftSave(SESSION_ID, questions, base)
    )
    const variants = [
      canonicalizeStudyDraftSave(
        '00000000-0000-4000-8000-000000000099',
        questions,
        base
      ),
      canonicalizeStudyDraftSave(SESSION_ID, questions, {
        ...base,
        expectedRevision: 1
      }),
      canonicalizeStudyDraftSave(SESSION_ID, questions, {
        ...base,
        currentOrdinal: 2
      }),
      canonicalizeStudyDraftSave(SESSION_ID, questions, {
        ...base,
        answers: [{ ...answerOne, selectedOptionId: OPTION_2 }, answerTwo]
      }),
      canonicalizeStudyDraftSave(SESSION_ID, questions, {
        ...base,
        answers: [{ ...answerOne, elapsedSec: 9 }, answerTwo]
      })
    ]

    for (const variant of variants) {
      expect(hashStudyDraftSave(variant)).not.toBe(baseline)
    }
  })
})

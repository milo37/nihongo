import { describe, expect, it } from 'vitest'
import {
  ResultRetrySelectionError,
  selectResultRetryCandidates,
  type ResultRetrySourceCandidate
} from '../src/selection/select-result-retry-candidates.js'

const candidate = (
  overrides: Partial<ResultRetrySourceCandidate> = {}
): ResultRetrySourceCandidate => ({
  isCorrect: false,
  ordinal: 1,
  questionId: 'question-1',
  questionLifecycleStatus: 'ACTIVE',
  questionVersionId: 'version-1',
  questionVersionStatus: 'PUBLISHED',
  ...overrides
})

describe('selectResultRetryCandidates', () => {
  it('오답 수는 보존하고 source ordinal 순서로 active historical pin만 선택한다', () => {
    expect(
      selectResultRetryCandidates([
        candidate({
          ordinal: 4,
          questionId: 'question-retired',
          questionVersionId: 'version-retired',
          questionVersionStatus: 'RETIRED'
        }),
        candidate({
          isCorrect: true,
          ordinal: 1,
          questionId: 'question-correct',
          questionVersionId: 'version-correct'
        }),
        candidate({
          ordinal: 3,
          questionId: 'question-archived',
          questionLifecycleStatus: 'ARCHIVED',
          questionVersionId: 'version-archived'
        }),
        candidate({ ordinal: 2 })
      ])
    ).toEqual({
      requestedCount: 3,
      candidates: [
        {
          ordinal: 2,
          questionId: 'question-1',
          questionVersionId: 'version-1'
        },
        {
          ordinal: 4,
          questionId: 'question-retired',
          questionVersionId: 'version-retired'
        }
      ]
    })
  })

  it('broken pin과 DRAFT version을 eligible 후보에서 제외한다', () => {
    expect(
      selectResultRetryCandidates([
        candidate({ questionId: null }),
        candidate({
          ordinal: 2,
          questionId: 'question-draft',
          questionVersionId: 'version-draft',
          questionVersionStatus: 'DRAFT'
        })
      ])
    ).toEqual({ requestedCount: 2, candidates: [] })
  })

  it('중복 stable question이나 pin을 fail closed한다', () => {
    expect(() =>
      selectResultRetryCandidates([
        candidate(),
        candidate({ ordinal: 2, questionVersionId: 'version-2' })
      ])
    ).toThrow(ResultRetrySelectionError)
  })
})

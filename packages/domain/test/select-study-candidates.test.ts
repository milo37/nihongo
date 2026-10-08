import { describe, expect, it } from 'vitest'
import {
  selectBookmarkStudyCandidates,
  selectDailyReviewStudyCandidates,
  selectRandomStudyCandidates,
  selectWeaknessStudyCandidates,
  selectWrongNoteStudyCandidates,
  StudySelectionError
} from '../src/selection/select-study-candidates.js'

const at = (value: string): Date => new Date(value)

describe('select study candidates', () => {
  it('ranks BOOKMARK candidates by creation instant and stable ID', () => {
    const selected = selectBookmarkStudyCandidates(
      [
        {
          questionId: 'q3',
          questionVersionId: 'v3',
          createdAt: at('2026-08-20T00:00:00.000Z')
        },
        {
          questionId: 'q2',
          questionVersionId: 'v2',
          createdAt: at('2026-08-21T00:00:00.000Z')
        },
        {
          questionId: 'q1',
          questionVersionId: 'v1',
          createdAt: at('2026-08-21T00:00:00.000Z')
        }
      ],
      2
    )

    expect(selected.map(({ questionId }) => questionId)).toEqual(['q1', 'q2'])
  })

  it('shuffles non-recent RANDOM candidates before recent candidates', () => {
    const values = [0, 0]
    let index = 0
    const selected = selectRandomStudyCandidates(
      [
        { questionId: 'q3', questionVersionId: 'v3', isRecent: true },
        { questionId: 'q2', questionVersionId: 'v2', isRecent: false },
        { questionId: 'q1', questionVersionId: 'v1', isRecent: false },
        { questionId: 'q4', questionVersionId: 'v4', isRecent: true }
      ],
      3,
      () => values[index++] ?? 0
    )

    expect(selected.map(({ questionId }) => questionId)).toEqual([
      'q2',
      'q1',
      'q4'
    ])
  })

  it('ranks WRONG_NOTE candidates by last wrong, count, and stable ID', () => {
    const selected = selectWrongNoteStudyCandidates(
      [
        {
          questionId: 'q3',
          questionVersionId: 'v3',
          lastWrongAt: at('2026-08-01T00:00:00.000Z'),
          wrongCount: 9
        },
        {
          questionId: 'q2',
          questionVersionId: 'v2',
          lastWrongAt: at('2026-08-02T00:00:00.000Z'),
          wrongCount: 2
        },
        {
          questionId: 'q1',
          questionVersionId: 'v1',
          lastWrongAt: at('2026-08-02T00:00:00.000Z'),
          wrongCount: 2
        }
      ],
      3
    )

    expect(selected.map(({ questionId }) => questionId)).toEqual([
      'q1',
      'q2',
      'q3'
    ])
  })

  it('ranks due DAILY_REVIEW candidates by instant, status, and ID', () => {
    const selected = selectDailyReviewStudyCandidates(
      [
        {
          questionId: 'q3',
          questionVersionId: 'v3',
          nextReviewAt: at('2026-08-01T00:00:00.000Z'),
          status: 'SOLVED'
        },
        {
          questionId: 'q2',
          questionVersionId: 'v2',
          nextReviewAt: at('2026-08-01T00:00:00.000Z'),
          status: 'AGAIN'
        },
        {
          questionId: 'q1',
          questionVersionId: 'v1',
          nextReviewAt: at('2026-07-31T23:59:59.999Z'),
          status: 'NEW'
        }
      ],
      3
    )

    expect(selected.map(({ questionId }) => questionId)).toEqual([
      'q1',
      'q2',
      'q3'
    ])
  })

  it('uses exact WEAKNESS ratios and stable tie breakers', () => {
    const selected = selectWeaknessStudyCandidates(
      [
        {
          questionId: 'q3',
          questionVersionId: 'v3',
          answeredCount: 6,
          incorrectCount: 3,
          lastAnsweredAt: at('2026-08-02T00:00:00.000Z')
        },
        {
          questionId: 'q2',
          questionVersionId: 'v2',
          answeredCount: 4,
          incorrectCount: 3,
          lastAnsweredAt: at('2026-08-03T00:00:00.000Z')
        },
        {
          questionId: 'q1',
          questionVersionId: 'v1',
          answeredCount: 8,
          incorrectCount: 6,
          lastAnsweredAt: at('2026-08-01T00:00:00.000Z')
        }
      ],
      2
    )

    expect(selected.map(({ questionId }) => questionId)).toEqual(['q1', 'q2'])
  })

  it('clamps to available candidates and rejects duplicate stable Questions', () => {
    expect(
      selectWrongNoteStudyCandidates(
        [
          {
            questionId: 'q1',
            questionVersionId: 'v1',
            lastWrongAt: at('2026-08-01T00:00:00.000Z'),
            wrongCount: 1
          }
        ],
        20
      )
    ).toHaveLength(1)

    expect(() =>
      selectRandomStudyCandidates(
        [
          { questionId: 'q1', questionVersionId: 'v1', isRecent: false },
          { questionId: 'q1', questionVersionId: 'v2', isRecent: true }
        ],
        2,
        () => 0
      )
    ).toThrowError(StudySelectionError)
  })
})

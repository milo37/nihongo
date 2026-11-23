import { describe, expect, it } from 'vitest'
import {
  selectBookmarkStudyCandidates,
  selectDailyReviewStudyCandidates,
  selectRandomStudyCandidates,
  selectToReviewStudyCandidates,
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

  it('shuffles never-seen RANDOM candidates before seen ones', () => {
    const values = [0, 0]
    let index = 0
    const selected = selectRandomStudyCandidates(
      [
        {
          questionId: 'q3',
          questionVersionId: 'v3',
          lastSeenAt: new Date('2026-11-20T00:00:00Z')
        },
        { questionId: 'q2', questionVersionId: 'v2', lastSeenAt: null },
        { questionId: 'q1', questionVersionId: 'v1', lastSeenAt: null },
        {
          questionId: 'q4',
          questionVersionId: 'v4',
          lastSeenAt: new Date('2026-11-20T00:00:00Z')
        }
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

  it('keeps the questions of one passage together, in passage order (#986)', () => {
    const candidates = [
      { questionId: 'q1', questionVersionId: 'v1', lastSeenAt: null },
      {
        questionId: 'q5',
        questionVersionId: 'v5',
        lastSeenAt: null,
        passageId: 'p1',
        passageOrder: 1
      },
      {
        questionId: 'q2',
        questionVersionId: 'v2',
        lastSeenAt: null,
        passageId: 'p1',
        passageOrder: 2
      },
      { questionId: 'q3', questionVersionId: 'v3', lastSeenAt: null },
      {
        questionId: 'q4',
        questionVersionId: 'v4',
        lastSeenAt: new Date('2026-11-20T00:00:00Z'),
        passageId: 'p2',
        passageOrder: 1
      },
      {
        questionId: 'q6',
        questionVersionId: 'v6',
        lastSeenAt: null,
        passageId: 'p2',
        passageOrder: 2
      }
    ]
    // Units sorted by their first question: [q1] [q3] [q5 q2]; p2 was seen.
    const selected = selectRandomStudyCandidates(candidates, 4, () => 0)
    expect(selected.map(({ questionId }) => questionId)).toEqual([
      'q3',
      'q5',
      'q2',
      'q1'
    ])
    // A pair that does not fit the last place is skipped whole, so the set
    // comes out one short.
    const three = selectRandomStudyCandidates(candidates, 3, () => 0.99)
    expect(three.map(({ questionId }) => questionId)).toEqual(['q1', 'q3'])
  })

  it('brings back the questions seen longest ago once all were seen (#1242)', () => {
    const day = (date: number) => new Date(`2026-11-${date}T00:00:00Z`)
    const candidates = [
      { questionId: 'q1', questionVersionId: 'v1', lastSeenAt: day(20) },
      { questionId: 'q2', questionVersionId: 'v2', lastSeenAt: day(11) },
      { questionId: 'q3', questionVersionId: 'v3', lastSeenAt: day(15) },
      // One passage: seen when its latest question was.
      {
        questionId: 'q4',
        questionVersionId: 'v4',
        lastSeenAt: day(10),
        passageId: 'p1',
        passageOrder: 1
      },
      {
        questionId: 'q5',
        questionVersionId: 'v5',
        lastSeenAt: day(18),
        passageId: 'p1',
        passageOrder: 2
      },
      { questionId: 'q6', questionVersionId: 'v6', lastSeenAt: null }
    ]
    for (const random of [() => 0, () => 0.5, () => 0.99]) {
      expect(
        selectRandomStudyCandidates(candidates, 6, random).map(
          ({ questionId }) => questionId
        )
      ).toEqual(['q6', 'q2', 'q3', 'q4', 'q5', 'q1'])
    }
    // Every question seen: the set starts again from the oldest. The pair
    // that does not fit the last place is skipped whole, as before.
    expect(
      selectRandomStudyCandidates(
        candidates.filter(({ questionId }) => questionId !== 'q6'),
        3,
        () => 0.5
      ).map(({ questionId }) => questionId)
    ).toEqual(['q2', 'q3', 'q1'])
    expect(
      selectRandomStudyCandidates(
        candidates.filter(({ questionId }) => questionId !== 'q6'),
        4,
        () => 0.5
      ).map(({ questionId }) => questionId)
    ).toEqual(['q2', 'q3', 'q4', 'q5'])
  })

  it('keeps questions seen at the same time in random order (#1242)', () => {
    const seen = new Date('2026-11-20T00:00:00Z')
    const candidates = ['q1', 'q2', 'q3'].map((questionId) => ({
      questionId,
      questionVersionId: `v-${questionId}`,
      lastSeenAt: seen
    }))
    const orders = new Set(
      [() => 0, () => 0.5, () => 0.99].map((random) =>
        selectRandomStudyCandidates(candidates, 3, random)
          .map(({ questionId }) => questionId)
          .join()
      )
    )
    expect(orders.size).toBeGreaterThan(1)
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

  it('ranks questions to review from the oldest wrong answer (JLP-812)', () => {
    const selected = selectToReviewStudyCandidates(
      [
        {
          questionId: 'q3',
          questionVersionId: 'v3',
          lastWrongAt: at('2026-08-02T00:00:00.000Z')
        },
        {
          questionId: 'q2',
          questionVersionId: 'v2',
          lastWrongAt: at('2026-08-01T00:00:00.000Z')
        },
        {
          questionId: 'q1',
          questionVersionId: 'v1',
          lastWrongAt: at('2026-08-01T00:00:00.000Z')
        }
      ],
      2
    )

    expect(selected.map(({ questionId }) => questionId)).toEqual(['q1', 'q2'])
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
          { questionId: 'q1', questionVersionId: 'v1', lastSeenAt: null },
          {
            questionId: 'q1',
            questionVersionId: 'v2',
            lastSeenAt: new Date('2026-11-20T00:00:00Z')
          }
        ],
        2,
        () => 0
      )
    ).toThrowError(StudySelectionError)
  })
})

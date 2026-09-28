import { getDashboardInsightsResponseSchema } from '@nihongo/contracts/dashboard/get-dashboard-insights'
import { dashboardInsightsConformanceFixture } from '@nihongo/contracts/testing/dashboard-insights-conformance'
import { describe, expect, it } from 'vitest'
import {
  DashboardInsightsMapperIntegrityError,
  toDashboardInsights
} from './dashboardInsightsMapper.js'
import type {
  DashboardInsightsNonTagRecord,
  DashboardInsightsReviewRecord,
  DashboardInsightsSnapshotRecord,
  DashboardInsightsTagRecord
} from './dashboardInsightsRepository.js'

const OBSERVED_AT = new Date('2026-09-28T12:00:00.000Z')
const LAST_ANSWERED_AT = new Date('2026-09-26T12:00:00.000Z')
const TAG_ID = '018f6b7a-1f4b-7d5e-8a91-000000000001'

const nonTagRow = (
  overrides: Partial<DashboardInsightsNonTagRecord> = {}
): DashboardInsightsNonTagRecord => ({
  kind: 'OVERALL',
  level: null,
  subject: null,
  questionType: null,
  attemptedCount: 8n,
  correctCount: 3n,
  incorrectCount: 5n,
  elapsedTotal: 96n,
  lastAnsweredAt: LAST_ANSWERED_AT,
  repeatExtra: 0n,
  ...overrides
})

const countsRow = (
  overrides: Partial<DashboardInsightsReviewRecord> = {}
): DashboardInsightsReviewRecord => ({
  kind: 'COUNTS',
  level: null,
  subject: null,
  totalCount: 0n,
  repeatedCount: 0n,
  earliestDueAt: null,
  questionId: null,
  questionText: null,
  wrongCount: null,
  status: null,
  lastWrongAt: null,
  isDue: null,
  ...overrides
})

const canonicalSnapshot = (): DashboardInsightsSnapshotRecord => ({
  clock: {
    observedAt: OBSERVED_AT,
    targetLevel: null,
    futureAnswerCount: 0n
  },
  nonTagRows: [
    nonTagRow(),
    nonTagRow({ kind: 'LEVEL', level: 'N2' }),
    nonTagRow({ kind: 'SUBJECT', subject: 'GRAMMAR' }),
    nonTagRow({
      kind: 'QUESTION_TYPE',
      questionType: 'SENTENCE_ORDER'
    }),
    nonTagRow({
      kind: 'QUESTION_TYPE_WEAKNESS',
      level: 'N2',
      subject: 'GRAMMAR',
      questionType: 'SENTENCE_ORDER',
      elapsedTotal: 0n,
      repeatExtra: 2n
    })
  ],
  tagRows: [
    {
      kind: 'TAG',
      level: null,
      subject: null,
      tagId: TAG_ID,
      tagLabel: '문장 배열',
      attemptedCount: 8n,
      correctCount: 3n,
      incorrectCount: 5n,
      elapsedTotal: 96n,
      lastAnsweredAt: LAST_ANSWERED_AT,
      repeatExtra: 0n
    }
  ],
  reviewRows: [
    countsRow(),
    countsRow({
      kind: 'WEAKNESS_ACTIONABLE',
      level: 'N2',
      subject: 'GRAMMAR',
      totalCount: 3n,
      repeatedCount: null
    })
  ],
  targetRows: []
})

const emptySnapshot = (): DashboardInsightsSnapshotRecord => ({
  clock: {
    observedAt: OBSERVED_AT,
    targetLevel: null,
    futureAnswerCount: 0n
  },
  nonTagRows: [
    nonTagRow({
      attemptedCount: 0n,
      correctCount: 0n,
      incorrectCount: 0n,
      elapsedTotal: 0n,
      lastAnsweredAt: null
    })
  ],
  tagRows: [],
  reviewRows: [countsRow()],
  targetRows: []
})

const tagId = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${String(index).padStart(12, '0')}`

describe('Dashboard insights mapper', () => {
  it('canonical raw snapshot을 shared conformance fixture와 byte-equivalent하게 만든다', () => {
    const response = toDashboardInsights(canonicalSnapshot())

    expect(response).toEqual(dashboardInsightsConformanceFixture)
    expect(getDashboardInsightsResponseSchema.parse(response)).toEqual(response)
  })

  it('표본 0 fixed dimension을 채우고 target 미설정 fallback을 만든다', () => {
    const response = toDashboardInsights(emptySnapshot())

    expect(response.stats.byLevel).toHaveLength(5)
    expect(response.stats.bySubject).toHaveLength(3)
    expect(response.stats.byQuestionType).toHaveLength(12)
    expect(
      response.stats.byLevel.every((item) => item.attemptedCount === 0)
    ).toBe(true)
    expect(response.weaknesses).toEqual([])
    expect(response.recommendations).toEqual([
      {
        rank: 1,
        kind: 'PRACTICE_SETUP',
        reason: { code: 'TARGET_LEVEL_NOT_SET' },
        action: { kind: 'OPEN_PRACTICE_SETUP' }
      }
    ])
    expect(response.personalizationFallbackReason).toBe('TARGET_LEVEL_NOT_SET')
  })

  it('추천 근거를 global top 10에 보존하고 101번째 tag facet도 bounded page에 포함한다', () => {
    const aggregate = {
      attemptedCount: 1_000n,
      correctCount: 500n,
      incorrectCount: 500n,
      elapsedTotal: 10_000n,
      lastAnsweredAt: LAST_ANSWERED_AT
    }
    const tagRows: DashboardInsightsTagRecord[] = Array.from(
      { length: 101 },
      (_, offset) => {
        const index = offset + 1
        const isLast = index === 101
        return {
          kind: 'TAG',
          level: null,
          subject: null,
          tagId: tagId(index),
          tagLabel: `태그 ${index}`,
          attemptedCount: isLast ? 20n : 30n,
          correctCount: 0n,
          incorrectCount: isLast ? 20n : 30n,
          elapsedTotal: isLast ? 200n : 300n,
          lastAnsweredAt: LAST_ANSWERED_AT,
          repeatExtra: 0n
        }
      }
    )
    for (let index = 92; index <= 101; index += 1) {
      tagRows.push({
        kind: 'TAG_WEAKNESS',
        level: 'N5',
        subject: 'VOCABULARY',
        tagId: tagId(index),
        tagLabel: `태그 ${index}`,
        attemptedCount: 20n,
        correctCount: 0n,
        incorrectCount: 20n,
        elapsedTotal: 0n,
        lastAnsweredAt: LAST_ANSWERED_AT,
        repeatExtra: index === 101 ? 19n : 0n
      })
    }
    const response = toDashboardInsights({
      clock: {
        observedAt: OBSERVED_AT,
        targetLevel: null,
        futureAnswerCount: 0n
      },
      nonTagRows: [
        nonTagRow(aggregate),
        nonTagRow({ kind: 'LEVEL', level: 'N5', ...aggregate }),
        nonTagRow({
          kind: 'SUBJECT',
          subject: 'VOCABULARY',
          ...aggregate
        }),
        nonTagRow({
          kind: 'QUESTION_TYPE',
          questionType: 'KANJI_READING',
          ...aggregate
        }),
        nonTagRow({
          kind: 'QUESTION_TYPE_WEAKNESS',
          level: 'N5',
          subject: 'VOCABULARY',
          questionType: 'KANJI_READING',
          attemptedCount: 5n,
          correctCount: 3n,
          incorrectCount: 2n,
          elapsedTotal: 0n,
          repeatExtra: 0n
        })
      ],
      tagRows,
      reviewRows: [
        countsRow(),
        countsRow({
          kind: 'WEAKNESS_ACTIONABLE',
          level: 'N5',
          subject: 'VOCABULARY',
          totalCount: 5n,
          repeatedCount: null
        })
      ],
      targetRows: []
    })

    expect(response.stats.byTag).toHaveLength(100)
    expect(response.stats.byTagTotal).toBe(101)
    expect(response.stats.byTagTruncated).toBe(true)
    expect(response.stats.byTag.map(({ tagId: id }) => id)).toContain(
      tagId(101)
    )
    expect(response.stats.byTag.map(({ tagId: id }) => id)).not.toContain(
      tagId(100)
    )
    expect(response.weaknesses).toHaveLength(10)
    expect(response.weaknesses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'QUESTION_TYPE|N5|VOCABULARY|KANJI_READING'
        }),
        expect.objectContaining({ key: `TAG|N5|VOCABULARY|${tagId(101)}` })
      ])
    )
    expect(response.recommendations[0]).toMatchObject({
      kind: 'RECENT_LOW_ACCURACY_TYPE',
      reason: { questionType: 'KANJI_READING' }
    })
  })

  it('unsafe count와 duplicate aggregate를 fail closed한다', () => {
    const unsafe = canonicalSnapshot()
    const duplicate = canonicalSnapshot()

    expect(() =>
      toDashboardInsights({
        ...unsafe,
        nonTagRows: [
          nonTagRow({
            attemptedCount: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
            correctCount: 0n,
            incorrectCount: BigInt(Number.MAX_SAFE_INTEGER) + 1n
          })
        ]
      })
    ).toThrow(DashboardInsightsMapperIntegrityError)
    expect(() =>
      toDashboardInsights({
        ...duplicate,
        nonTagRows: [...duplicate.nonTagRows, duplicate.nonTagRows[0]!]
      })
    ).toThrow(DashboardInsightsMapperIntegrityError)

    const ineligibleRepeated = canonicalSnapshot()
    expect(() =>
      toDashboardInsights({
        ...ineligibleRepeated,
        reviewRows: [
          countsRow({ repeatedCount: 1n }),
          countsRow({
            kind: 'REPEATED_CANDIDATE',
            level: 'N2',
            subject: 'GRAMMAR',
            totalCount: 1n,
            repeatedCount: null,
            questionId: TAG_ID,
            questionText: '반복 오답 후보',
            wrongCount: 1,
            status: 'NEW',
            lastWrongAt: LAST_ANSWERED_AT,
            isDue: false
          })
        ]
      })
    ).toThrow(DashboardInsightsMapperIntegrityError)

    const hiddenInvalidTag = canonicalSnapshot()
    expect(() =>
      toDashboardInsights({
        ...hiddenInvalidTag,
        tagRows: [
          ...hiddenInvalidTag.tagRows,
          ...Array.from({ length: 99 }, (_, offset) => ({
            kind: 'TAG' as const,
            level: null,
            subject: null,
            tagId: tagId(offset + 2),
            tagLabel: `추가 태그 ${offset + 2}`,
            attemptedCount: 1n,
            correctCount: 1n,
            incorrectCount: 0n,
            elapsedTotal: 1n,
            lastAnsweredAt: LAST_ANSWERED_AT,
            repeatExtra: 0n
          })),
          {
            kind: 'TAG',
            level: null,
            subject: null,
            tagId: 'zz-invalid-capped-tag',
            tagLabel: '숨겨진 잘못된 태그',
            attemptedCount: 1n,
            correctCount: 1n,
            incorrectCount: 0n,
            elapsedTotal: 1n,
            lastAnsweredAt: LAST_ANSWERED_AT,
            repeatExtra: 0n
          }
        ]
      })
    ).toThrow(DashboardInsightsMapperIntegrityError)
  })
})

import { describe, expect, it } from 'vitest'
import {
  dashboardInsightMetricSchema,
  dashboardRecommendationSchema,
  getDashboardInsightsErrorSchema,
  getDashboardInsightsQuerySchema,
  getDashboardInsightsResponseSchema
} from '../src/dashboard/get-dashboard-insights.js'
import { dashboardInsightsConformanceFixture } from '../src/testing/dashboard-insights-conformance.js'

const id = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${index.toString(16).padStart(12, '0')}`

describe('dashboard insights contracts', () => {
  it('canonical weakness-v1/recommendation-v1 fixture를 strict parse한다', () => {
    expect(
      getDashboardInsightsResponseSchema.parse(
        dashboardInsightsConformanceFixture
      )
    ).toEqual(dashboardInsightsConformanceFixture)
    expect(getDashboardInsightsQuerySchema.parse({})).toEqual({})
    expect(
      getDashboardInsightsQuerySchema.safeParse({ userId: id(9) }).success
    ).toBe(false)
  })

  it('표본 0을 null rate/average로 구분하고 basis-point rate를 검증한다', () => {
    expect(
      dashboardInsightMetricSchema.safeParse({
        attemptedCount: 0,
        correctCount: 0,
        correctRateBasisPoints: null,
        averageElapsedSec: null,
        lastAnsweredAt: null
      }).success
    ).toBe(true)
    expect(
      dashboardInsightMetricSchema.safeParse({
        attemptedCount: 1,
        correctCount: 1,
        correctRateBasisPoints: 10_000,
        averageElapsedSec: 86_401,
        lastAnsweredAt: '2026-09-28T00:00:00.000Z'
      }).success
    ).toBe(false)
    expect(
      dashboardInsightMetricSchema.safeParse({
        attemptedCount: 0,
        correctCount: 0,
        correctRateBasisPoints: 0,
        averageElapsedSec: 0,
        lastAnsweredAt: null
      }).success
    ).toBe(false)
    expect(
      dashboardInsightMetricSchema.safeParse({
        attemptedCount: 6,
        correctCount: 1,
        correctRateBasisPoints: 1_667,
        averageElapsedSec: 4,
        lastAnsweredAt: '2026-09-28T00:00:00.000Z'
      }).success
    ).toBe(true)
  })

  it('90일 window와 score component 변조를 거부한다', () => {
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        window: {
          ...dashboardInsightsConformanceFixture.window,
          fromInclusive: '2026-07-01T12:00:00.000Z'
        }
      }).success
    ).toBe(false)
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        weaknesses: dashboardInsightsConformanceFixture.weaknesses.map(
          (weakness) => ({ ...weakness, scoreBasisPoints: 3_001 })
        )
      }).success
    ).toBe(false)
  })

  it('domain weakness-v1의 0bp 반올림 경계를 수용한다', () => {
    const emptyMetric = {
      attemptedCount: 0,
      correctCount: 0,
      correctRateBasisPoints: null,
      averageElapsedSec: null,
      lastAnsweredAt: null
    } as const
    const nearPerfectMetric = {
      attemptedCount: 20_001,
      correctCount: 20_000,
      correctRateBasisPoints: 10_000,
      averageElapsedSec: 1,
      lastAnsweredAt: '2026-09-26T12:00:00.000Z'
    } as const
    const response = {
      ...dashboardInsightsConformanceFixture,
      stats: {
        overall: nearPerfectMetric,
        byLevel: dashboardInsightsConformanceFixture.stats.byLevel.map(
          (stat) => ({
            ...(stat.level === 'N2' ? nearPerfectMetric : emptyMetric),
            level: stat.level
          })
        ),
        bySubject: dashboardInsightsConformanceFixture.stats.bySubject.map(
          (stat) => ({
            ...(stat.subject === 'GRAMMAR' ? nearPerfectMetric : emptyMetric),
            subject: stat.subject
          })
        ),
        byQuestionType:
          dashboardInsightsConformanceFixture.stats.byQuestionType.map(
            (stat) => ({
              ...(stat.questionType === 'SENTENCE_ORDER'
                ? nearPerfectMetric
                : emptyMetric),
              questionType: stat.questionType
            })
          ),
        byTag: dashboardInsightsConformanceFixture.stats.byTag,
        byTagTotal: 1,
        byTagTruncated: false
      },
      weaknesses: [
        {
          dimension: 'SUBJECT',
          key: 'SUBJECT|N2|GRAMMAR',
          level: 'N2',
          subject: 'GRAMMAR',
          attemptedCount: 20_001,
          incorrectCount: 1,
          repeatExtra: 0,
          lastAnsweredAt: '2026-09-26T12:00:00.000Z',
          ageDays: 2,
          errorRateBasisPoints: 0,
          recencyWeightBasisPoints: 10_000,
          repeatWeightBasisPoints: 10_000,
          sampleConfidenceBasisPoints: 10_000,
          scoreBasisPoints: 0
        }
      ],
      recommendations: [
        {
          rank: 1,
          kind: 'PRACTICE_SETUP',
          reason: { code: 'TARGET_LEVEL_NOT_SET' },
          action: { kind: 'OPEN_PRACTICE_SETUP' }
        }
      ],
      personalizationFallbackReason: 'TARGET_LEVEL_NOT_SET'
    }

    expect(getDashboardInsightsResponseSchema.safeParse(response).success).toBe(
      true
    )
  })

  it('fixed dimension 합·순서와 recommendation rank/action을 검증한다', () => {
    const reversedLevels = [
      ...dashboardInsightsConformanceFixture.stats.byLevel
    ].reverse()
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        stats: {
          ...dashboardInsightsConformanceFixture.stats,
          byLevel: reversedLevels
        }
      }).success
    ).toBe(false)
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        recommendations:
          dashboardInsightsConformanceFixture.recommendations.map(
            (recommendation) => ({ ...recommendation, rank: 2 })
          )
      }).success
    ).toBe(false)
    const recommendation =
      dashboardInsightsConformanceFixture.recommendations[0]
    expect(recommendation).toBeDefined()
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        recommendations: recommendation
          ? [
              {
                ...recommendation,
                action: { ...recommendation.action, count: 10 }
              }
            ]
          : []
      }).success
    ).toBe(false)
  })

  it('recommendation을 같은 snapshot weakness·queue 근거에 결속한다', () => {
    const recommendation =
      dashboardInsightsConformanceFixture.recommendations[0]
    expect(recommendation?.kind).toBe('RECENT_LOW_ACCURACY_TYPE')
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        recommendations:
          recommendation?.kind === 'RECENT_LOW_ACCURACY_TYPE'
            ? [
                {
                  ...recommendation,
                  reason: { ...recommendation.reason, scoreBasisPoints: 999 },
                  action: {
                    ...recommendation.action,
                    level: 'N1',
                    subject: 'READING'
                  }
                }
              ]
            : []
      }).success
    ).toBe(false)

    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        reviewQueueCounts: { due: 0, repeated: 0 },
        recommendations: [
          {
            rank: 1,
            kind: 'DUE_REVIEW',
            reason: {
              code: 'DUE_REVIEW_COUNT',
              dueCount: 1,
              earliestDueAt: '2026-09-29T12:00:00.000Z',
              level: 'N2',
              subject: 'GRAMMAR'
            },
            action: {
              kind: 'START_SESSION',
              mode: 'DAILY_REVIEW',
              level: 'N2',
              subject: 'GRAMMAR',
              count: 5
            }
          }
        ],
        personalizationFallbackReason: null
      }).success
    ).toBe(false)

    expect(
      dashboardRecommendationSchema.safeParse({
        rank: 1,
        kind: 'RECENT_LOW_ACCURACY_TYPE',
        reason: {
          code: 'RECENT_LOW_ACCURACY_TYPE',
          questionType: 'SENTENCE_ORDER',
          attemptedCount: 50_000,
          incorrectCount: 19_999,
          errorRateBasisPoints: 4_000,
          scoreBasisPoints: 1,
          actionableCandidateCount: 1
        },
        action: {
          kind: 'START_SESSION',
          mode: 'WEAKNESS',
          level: 'N2',
          subject: 'GRAMMAR',
          count: 5
        }
      }).success
    ).toBe(false)

    expect(
      dashboardRecommendationSchema.safeParse({
        rank: 1,
        kind: 'DUE_REVIEW',
        reason: {
          code: 'DUE_REVIEW_COUNT',
          dueCount: 1,
          earliestDueAt: '2026-09-27T12:00:00.000Z',
          level: 'N2',
          subject: 'GRAMMAR'
        },
        action: {
          kind: 'START_SESSION',
          mode: 'DAILY_REVIEW',
          level: 'N1',
          subject: 'GRAMMAR',
          count: 5
        }
      }).success
    ).toBe(false)
    expect(
      dashboardRecommendationSchema.safeParse({
        rank: 1,
        kind: 'REPEATED_WRONG',
        reason: {
          code: 'REPEATED_WRONG_COUNT',
          level: 'N2',
          subject: 'GRAMMAR',
          questionId: id(1),
          questionPreview: '문제',
          wrongCount: 2,
          lastWrongAt: '2026-09-27T12:00:00.000Z'
        },
        action: { kind: 'START_TARGETED_REVIEW', questionId: id(2) }
      }).success
    ).toBe(false)
    expect(
      dashboardRecommendationSchema.safeParse({
        rank: 1,
        kind: 'TARGET_LEVEL_PRACTICE',
        reason: {
          code: 'TARGET_LEVEL_RECENT_GAP',
          catalogCount: 8,
          nonRecentCount: 8,
          lastStudiedAt: null,
          level: 'N2',
          subject: 'GRAMMAR'
        },
        action: {
          kind: 'START_SESSION',
          mode: 'RANDOM',
          level: 'N2',
          subject: 'READING',
          count: 5
        }
      }).success
    ).toBe(false)
  })

  it('weakness를 aggregate에 결속하고 같은 WEAKNESS target 중복을 거부한다', () => {
    const byLevel = dashboardInsightsConformanceFixture.stats.byLevel.map(
      (stat) =>
        stat.level === 'N2'
          ? {
              ...stat,
              attemptedCount: 7,
              correctCount: 2,
              correctRateBasisPoints: 2_857
            }
          : stat.level === 'N5'
            ? {
                ...stat,
                attemptedCount: 1,
                correctCount: 1,
                correctRateBasisPoints: 10_000,
                averageElapsedSec: 1,
                lastAnsweredAt:
                  stat.lastAnsweredAt ?? '2026-09-25T12:00:00.000Z'
              }
            : stat
    )
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        stats: { ...dashboardInsightsConformanceFixture.stats, byLevel }
      }).success
    ).toBe(false)

    const subjectWeakness = {
      dimension: 'SUBJECT' as const,
      key: 'SUBJECT|N2|GRAMMAR',
      level: 'N2' as const,
      subject: 'GRAMMAR' as const,
      attemptedCount: 8,
      incorrectCount: 5,
      repeatExtra: 2,
      lastAnsweredAt: '2026-08-29T12:00:00.000Z',
      ageDays: 30,
      errorRateBasisPoints: 6_250,
      recencyWeightBasisPoints: 7_000 as const,
      repeatWeightBasisPoints: 12_000,
      sampleConfidenceBasisPoints: 4_000,
      scoreBasisPoints: 2_100
    }
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        weaknesses: [
          ...dashboardInsightsConformanceFixture.weaknesses,
          subjectWeakness
        ],
        recommendations: [
          ...dashboardInsightsConformanceFixture.recommendations,
          {
            rank: 2,
            kind: 'STALE_WEAK_SUBJECT',
            reason: {
              code: 'STALE_WEAK_SUBJECT',
              attemptedCount: 8,
              incorrectCount: 5,
              errorRateBasisPoints: 6_250,
              scoreBasisPoints: 2_100,
              ageDays: 30,
              actionableCandidateCount: 10
            },
            action: {
              kind: 'START_SESSION',
              mode: 'WEAKNESS',
              level: 'N2',
              subject: 'GRAMMAR',
              count: 10
            }
          }
        ]
      }).success
    ).toBe(false)

    const fiveWrongMetric = {
      attemptedCount: 5,
      correctCount: 0,
      correctRateBasisPoints: 0,
      averageElapsedSec: 12,
      lastAnsweredAt: '2026-09-26T12:00:00.000Z'
    } as const
    const combinedMetric = {
      attemptedCount: 13,
      correctCount: 3,
      correctRateBasisPoints: 2_308,
      averageElapsedSec: 12,
      lastAnsweredAt: '2026-09-26T12:00:00.000Z'
    } as const
    const strongerSameTargetWeakness = {
      dimension: 'QUESTION_TYPE' as const,
      key: 'QUESTION_TYPE|N2|GRAMMAR|GRAMMAR_SELECT',
      level: 'N2' as const,
      subject: 'GRAMMAR' as const,
      questionType: 'GRAMMAR_SELECT' as const,
      attemptedCount: 5,
      incorrectCount: 5,
      repeatExtra: 4,
      lastAnsweredAt: '2026-09-26T12:00:00.000Z',
      ageDays: 2,
      errorRateBasisPoints: 10_000,
      recencyWeightBasisPoints: 10_000 as const,
      repeatWeightBasisPoints: 14_000,
      sampleConfidenceBasisPoints: 2_500,
      scoreBasisPoints: 3_500
    }
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        stats: {
          ...dashboardInsightsConformanceFixture.stats,
          overall: combinedMetric,
          byLevel: dashboardInsightsConformanceFixture.stats.byLevel.map(
            (stat) => ({
              ...(stat.level === 'N2' ? combinedMetric : stat),
              level: stat.level
            })
          ),
          bySubject: dashboardInsightsConformanceFixture.stats.bySubject.map(
            (stat) => ({
              ...(stat.subject === 'GRAMMAR' ? combinedMetric : stat),
              subject: stat.subject
            })
          ),
          byQuestionType:
            dashboardInsightsConformanceFixture.stats.byQuestionType.map(
              (stat) => ({
                ...(stat.questionType === 'GRAMMAR_SELECT'
                  ? fiveWrongMetric
                  : stat),
                questionType: stat.questionType
              })
            )
        },
        weaknesses: [
          strongerSameTargetWeakness,
          ...dashboardInsightsConformanceFixture.weaknesses
        ]
      }).success
    ).toBe(false)
  })

  it('setup fallback과 target recommendation 동시 반환을 거부한다', () => {
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        recommendations: [
          {
            rank: 1,
            kind: 'TARGET_LEVEL_PRACTICE',
            reason: {
              code: 'TARGET_LEVEL_RECENT_GAP',
              catalogCount: 8,
              nonRecentCount: 8,
              lastStudiedAt: null,
              level: 'N2',
              subject: 'GRAMMAR'
            },
            action: {
              kind: 'START_SESSION',
              mode: 'RANDOM',
              level: 'N2',
              subject: 'GRAMMAR',
              count: 5
            }
          },
          {
            rank: 2,
            kind: 'PRACTICE_SETUP',
            reason: { code: 'TARGET_LEVEL_NOT_SET' },
            action: { kind: 'OPEN_PRACTICE_SETUP' }
          }
        ],
        personalizationFallbackReason: 'TARGET_LEVEL_NOT_SET'
      }).success
    ).toBe(false)
  })

  it('metric/weakness taxonomy와 response snapshot 시간 경계를 검증한다', () => {
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        stats: {
          ...dashboardInsightsConformanceFixture.stats,
          overall: {
            ...dashboardInsightsConformanceFixture.stats.overall,
            lastAnsweredAt: '2026-09-28T12:00:00.001Z'
          }
        }
      }).success
    ).toBe(false)
    const weakness = dashboardInsightsConformanceFixture.weaknesses[0]
    expect(weakness?.dimension).toBe('QUESTION_TYPE')
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        weaknesses:
          weakness?.dimension === 'QUESTION_TYPE'
            ? [
                {
                  ...weakness,
                  key: 'QUESTION_TYPE|N2|READING|SENTENCE_ORDER',
                  subject: 'READING'
                }
              ]
            : []
      }).success
    ).toBe(false)
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        weaknesses: [
          {
            ...weakness,
            key: 'QUESTION_TYPE|N5|READING|LONG_READING',
            level: 'N5',
            subject: 'READING',
            questionType: 'LONG_READING'
          }
        ]
      }).success
    ).toBe(false)
  })

  it('tag facet은 독립 분모라 overall보다 큰 합도 허용한다', () => {
    const tag = dashboardInsightsConformanceFixture.stats.byTag[0]
    expect(tag).toBeDefined()
    const parsed = getDashboardInsightsResponseSchema.safeParse({
      ...dashboardInsightsConformanceFixture,
      stats: {
        ...dashboardInsightsConformanceFixture.stats,
        byTag: tag
          ? [
              tag,
              {
                ...tag,
                tagId: id(2),
                tagLabel: '복수 태그'
              }
            ]
          : [],
        byTagTotal: 2,
        byTagTruncated: false
      }
    })
    expect(parsed.success).toBe(true)

    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        stats: {
          ...dashboardInsightsConformanceFixture.stats,
          byTag: Array.from({ length: 101 }, (_, index) => ({
            ...tag,
            tagId: id(index + 1),
            tagLabel: `태그 ${index + 1}`
          })),
          byTagTotal: 101,
          byTagTruncated: false
        }
      }).success
    ).toBe(false)

    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        stats: {
          ...dashboardInsightsConformanceFixture.stats,
          byTag: Array.from({ length: 100 }, (_, index) => ({
            ...tag,
            tagId: id(index + 1),
            tagLabel: `태그 ${index + 1}`
          })),
          byTagTotal: 101,
          byTagTruncated: true
        }
      }).success
    ).toBe(true)

    const weakness = dashboardInsightsConformanceFixture.weaknesses[0]
    expect(
      getDashboardInsightsResponseSchema.safeParse({
        ...dashboardInsightsConformanceFixture,
        weaknesses: weakness
          ? [
              {
                ...weakness,
                dimension: 'TAG',
                key: `TAG|N2|GRAMMAR|${id(999)}`,
                tagId: id(999),
                tagLabel: '누락 태그'
              }
            ]
          : [],
        recommendations: [
          {
            rank: 1,
            kind: 'PRACTICE_SETUP',
            reason: { code: 'TARGET_LEVEL_NOT_SET' },
            action: { kind: 'OPEN_PRACTICE_SETUP' }
          }
        ],
        personalizationFallbackReason: 'TARGET_LEVEL_NOT_SET'
      }).success
    ).toBe(false)
  })

  it('operation error code를 닫힌 집합으로 유지한다', () => {
    const failure = {
      message: '요청을 처리할 수 없습니다.',
      requestId: id(80),
      retryable: false
    }
    expect(
      getDashboardInsightsErrorSchema.safeParse({
        ...failure,
        code: 'AUTHENTICATION_REQUIRED'
      }).success
    ).toBe(true)
    expect(
      getDashboardInsightsErrorSchema.safeParse({
        ...failure,
        code: 'RESOURCE_NOT_FOUND'
      }).success
    ).toBe(false)
  })
})

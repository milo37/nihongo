import type {
  DashboardInsightMetric,
  GetDashboardInsightsResponse
} from '../dashboard/get-dashboard-insights.js'

const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
const SUBJECTS = ['VOCABULARY', 'GRAMMAR', 'READING'] as const
const QUESTION_TYPES = [
  'KANJI_READING',
  'ORTHOGRAPHY',
  'CONTEXT_VOCABULARY',
  'PARAPHRASE',
  'WORD_USAGE',
  'GRAMMAR_SELECT',
  'SENTENCE_ORDER',
  'TEXT_GRAMMAR',
  'SHORT_READING',
  'MEDIUM_READING',
  'LONG_READING',
  'INFO_RETRIEVAL'
] as const

const emptyMetric = (): DashboardInsightMetric => ({
  attemptedCount: 0,
  correctCount: 0,
  correctRateBasisPoints: null,
  averageElapsedSec: null,
  lastAnsweredAt: null
})

const populatedMetric = (): DashboardInsightMetric => ({
  attemptedCount: 8,
  correctCount: 3,
  correctRateBasisPoints: 3_750,
  averageElapsedSec: 12,
  lastAnsweredAt: '2026-09-26T12:00:00.000Z'
})

export const dashboardInsightsConformanceFixture: GetDashboardInsightsResponse =
  {
    algorithm: {
      weakness: 'weakness-v1',
      recommendation: 'recommendation-v1'
    },
    observedAt: '2026-09-28T12:00:00.000Z',
    window: {
      fromInclusive: '2026-06-30T12:00:00.000Z',
      toInclusive: '2026-09-28T12:00:00.000Z',
      durationDays: 90,
      minAttempts: 5,
      fullConfidenceAt: 20
    },
    stats: {
      overall: populatedMetric(),
      byLevel: LEVELS.map((level) => ({
        ...(level === 'N2' ? populatedMetric() : emptyMetric()),
        level
      })),
      bySubject: SUBJECTS.map((subject) => ({
        ...(subject === 'GRAMMAR' ? populatedMetric() : emptyMetric()),
        subject
      })),
      byQuestionType: QUESTION_TYPES.map((questionType) => ({
        ...(questionType === 'SENTENCE_ORDER'
          ? populatedMetric()
          : emptyMetric()),
        questionType
      })),
      byTag: [
        {
          ...populatedMetric(),
          tagId: '018f6b7a-1f4b-7d5e-8a91-000000000001',
          tagLabel: '문장 배열'
        }
      ],
      byTagTotal: 1,
      byTagTruncated: false
    },
    reviewQueueCounts: { due: 0, repeated: 0 },
    weaknesses: [
      {
        dimension: 'QUESTION_TYPE',
        key: 'QUESTION_TYPE|N2|GRAMMAR|SENTENCE_ORDER',
        level: 'N2',
        subject: 'GRAMMAR',
        questionType: 'SENTENCE_ORDER',
        attemptedCount: 8,
        incorrectCount: 5,
        repeatExtra: 2,
        lastAnsweredAt: '2026-09-26T12:00:00.000Z',
        ageDays: 2,
        errorRateBasisPoints: 6_250,
        recencyWeightBasisPoints: 10_000,
        repeatWeightBasisPoints: 12_000,
        sampleConfidenceBasisPoints: 4_000,
        scoreBasisPoints: 3_000
      }
    ],
    recommendations: [
      {
        rank: 1,
        kind: 'RECENT_LOW_ACCURACY_TYPE',
        reason: {
          code: 'RECENT_LOW_ACCURACY_TYPE',
          questionType: 'SENTENCE_ORDER',
          attemptedCount: 8,
          incorrectCount: 5,
          errorRateBasisPoints: 6_250,
          scoreBasisPoints: 3_000,
          actionableCandidateCount: 3
        },
        action: {
          kind: 'START_SESSION',
          mode: 'WEAKNESS',
          level: 'N2',
          subject: 'GRAMMAR',
          count: 5
        }
      }
    ],
    personalizationFallbackReason: null
  }

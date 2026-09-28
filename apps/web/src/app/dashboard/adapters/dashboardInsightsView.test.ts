import type { DashboardRecommendation } from '@nihongo/contracts/dashboard/get-dashboard-insights'
import { dashboardInsightsConformanceFixture } from '@nihongo/contracts/testing/dashboard-insights-conformance'
import { describe, expect, it } from 'vitest'
import {
  formatDashboardBasisPoints,
  toDashboardInsightsView
} from '@app/dashboard/adapters/dashboardInsightsView'

const recommendations: DashboardRecommendation[] = [
  {
    rank: 1,
    kind: 'DUE_REVIEW',
    reason: {
      code: 'DUE_REVIEW_COUNT',
      dueCount: 3,
      earliestDueAt: '2026-09-28T10:00:00.000Z',
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
  },
  {
    rank: 2,
    kind: 'REPEATED_WRONG',
    reason: {
      code: 'REPEATED_WRONG_COUNT',
      level: 'N2',
      subject: 'GRAMMAR',
      questionId: '018f6b7a-1f4b-7d5e-8a91-000000000001',
      questionPreview: '문장 배열 문제',
      wrongCount: 2,
      lastWrongAt: '2026-09-27T10:00:00.000Z'
    },
    action: {
      kind: 'START_TARGETED_REVIEW',
      questionId: '018f6b7a-1f4b-7d5e-8a91-000000000001'
    }
  },
  dashboardInsightsConformanceFixture.recommendations[0]!,
  {
    rank: 4,
    kind: 'STALE_WEAK_SUBJECT',
    reason: {
      code: 'STALE_WEAK_SUBJECT',
      attemptedCount: 5,
      incorrectCount: 2,
      errorRateBasisPoints: 4_000,
      scoreBasisPoints: 700,
      ageDays: 40,
      actionableCandidateCount: 1
    },
    action: {
      kind: 'START_SESSION',
      mode: 'WEAKNESS',
      level: 'N3',
      subject: 'READING',
      count: 5
    }
  },
  {
    rank: 5,
    kind: 'TARGET_LEVEL_PRACTICE',
    reason: {
      code: 'TARGET_LEVEL_RECENT_GAP',
      catalogCount: 8,
      nonRecentCount: 6,
      lastStudiedAt: null,
      level: 'N2',
      subject: 'VOCABULARY'
    },
    action: {
      kind: 'START_SESSION',
      mode: 'RANDOM',
      level: 'N2',
      subject: 'VOCABULARY',
      count: 5
    }
  },
  {
    rank: 1,
    kind: 'PRACTICE_SETUP',
    reason: { code: 'TARGET_LEVEL_NOT_SET' },
    action: { kind: 'OPEN_PRACTICE_SETUP' }
  }
]

describe('dashboardInsightsView', () => {
  it('basis point의 null, 실제 0, 소수 퍼센트를 구분한다', () => {
    expect(formatDashboardBasisPoints(null)).toBe('표본 없음')
    expect(formatDashboardBasisPoints(0)).toBe('0%')
    expect(formatDashboardBasisPoints(3_750)).toBe('37.5%')
    expect(formatDashboardBasisPoints(3_755)).toBe('37.55%')
  })

  it('여섯 recommendation kind를 한국어 근거로 exhaustive 변환하고 typed action을 보존한다', () => {
    const view = toDashboardInsightsView({
      ...dashboardInsightsConformanceFixture,
      recommendations
    })

    expect(view.recommendations.map(({ title }) => title)).toEqual([
      '오늘 복습부터 시작하세요',
      '반복해서 틀린 문제를 다시 확인하세요',
      '최근 정확도가 낮은 유형을 연습하세요',
      '오래 쉬었던 약한 과목을 다시 잡아보세요',
      '목표 급수의 다음 문제를 풀어보세요',
      '목표 급수를 먼저 설정해 주세요'
    ])
    expect(view.recommendations[2]?.reason).toContain('정답률은 37.5%')
    expect(view.recommendations.map(({ action }) => action)).toEqual(
      recommendations.map(({ action }) => action)
    )
  })
})

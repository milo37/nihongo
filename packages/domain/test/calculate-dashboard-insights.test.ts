import { describe, expect, it } from 'vitest'
import {
  buildDashboardRecommendations,
  calculateDashboardWeakness,
  compareDashboardWeaknesses,
  createLevelSubjectKey,
  DashboardInsightCalculationError,
  selectTopDashboardWeaknesses,
  toDashboardSetupCount,
  type DashboardQuestionTypeWeaknessCandidate,
  type DashboardScoredWeakness,
  type DashboardSubjectWeaknessCandidate,
  type DashboardTagWeaknessCandidate
} from '../src/dashboard/calculate-dashboard-insights.js'

const observedAt = new Date('2026-09-28T12:00:00.000Z')
const daysAgo = (days: number, extraMilliseconds = 0): Date =>
  new Date(observedAt.getTime() - days * 86_400_000 - extraMilliseconds)

const typeCandidate = (
  overrides: Partial<DashboardQuestionTypeWeaknessCandidate> = {}
): DashboardQuestionTypeWeaknessCandidate => ({
  dimension: 'QUESTION_TYPE',
  key: 'QUESTION_TYPE|N2|GRAMMAR|SENTENCE_ORDER',
  level: 'N2',
  subject: 'GRAMMAR',
  questionType: 'SENTENCE_ORDER',
  attemptedCount: 8,
  incorrectCount: 5,
  repeatExtra: 2,
  lastAnsweredAt: daysAgo(2),
  ...overrides
})

const subjectCandidate = (
  overrides: Partial<DashboardSubjectWeaknessCandidate> = {}
): DashboardSubjectWeaknessCandidate => ({
  dimension: 'SUBJECT',
  key: 'SUBJECT|N2|READING',
  level: 'N2',
  subject: 'READING',
  attemptedCount: 10,
  incorrectCount: 5,
  repeatExtra: 1,
  lastAnsweredAt: daysAgo(45),
  ...overrides
})

const tagCandidate = (
  tagId: string,
  overrides: Partial<DashboardTagWeaknessCandidate> = {}
): DashboardTagWeaknessCandidate => ({
  dimension: 'TAG',
  key: `TAG|N2|GRAMMAR|${tagId}`,
  level: 'N2',
  subject: 'GRAMMAR',
  tagId,
  tagLabel: `tag-${tagId}`,
  attemptedCount: 6,
  incorrectCount: 3,
  repeatExtra: 0,
  lastAnsweredAt: daysAgo(2),
  ...overrides
})

const score = (
  candidate:
    | DashboardQuestionTypeWeaknessCandidate
    | DashboardSubjectWeaknessCandidate
): DashboardScoredWeakness => {
  const result = calculateDashboardWeakness(candidate, observedAt)
  if (!result) {
    throw new Error('fixture must produce a scored weakness')
  }
  return result
}

describe('dashboard insight domain', () => {
  it('weakness-v1 정수 산식과 recency fixture를 재현한다', () => {
    expect(
      calculateDashboardWeakness(typeCandidate(), observedAt)
    ).toMatchObject({
      errorRateBasisPoints: 6250,
      recencyWeightBasisPoints: 10_000,
      repeatWeightBasisPoints: 12_000,
      sampleConfidenceBasisPoints: 4_000,
      scoreBasisPoints: 3_000,
      ageDays: 2
    })
    expect(
      calculateDashboardWeakness(
        typeCandidate({ lastAnsweredAt: daysAgo(40) }),
        observedAt
      )
    ).toMatchObject({
      recencyWeightBasisPoints: 7_000,
      scoreBasisPoints: 2_100
    })
    expect(
      calculateDashboardWeakness(
        typeCandidate({
          attemptedCount: 20,
          incorrectCount: 10,
          repeatExtra: 4,
          lastAnsweredAt: daysAgo(10)
        }),
        observedAt
      )
    ).toMatchObject({ scoreBasisPoints: 5_100 })
    expect(
      calculateDashboardWeakness(subjectCandidate(), observedAt)
    ).toMatchObject({ scoreBasisPoints: 1_925 })
    expect(
      calculateDashboardWeakness(
        typeCandidate({
          attemptedCount: 6,
          incorrectCount: 1,
          repeatExtra: 0
        }),
        observedAt
      )
    ).toMatchObject({
      errorRateBasisPoints: 1_667,
      repeatWeightBasisPoints: 10_000,
      sampleConfidenceBasisPoints: 3_000
    })
    expect(
      calculateDashboardWeakness(
        typeCandidate({
          attemptedCount: Number.MAX_SAFE_INTEGER,
          incorrectCount: 1,
          repeatExtra: 0
        }),
        observedAt
      )
    ).toMatchObject({ sampleConfidenceBasisPoints: 10_000 })
  })

  it('최소 표본과 30/90일 경계를 닫고 window 밖·미래 시각을 거부한다', () => {
    expect(
      calculateDashboardWeakness(
        typeCandidate({ attemptedCount: 4, incorrectCount: 4, repeatExtra: 3 }),
        observedAt
      )
    ).toBeNull()
    expect(
      calculateDashboardWeakness(
        typeCandidate({ lastAnsweredAt: daysAgo(30) }),
        observedAt
      )
    ).toMatchObject({ ageDays: 30, recencyWeightBasisPoints: 7_000 })
    expect(
      calculateDashboardWeakness(
        typeCandidate({ lastAnsweredAt: daysAgo(90) }),
        observedAt
      )
    ).toMatchObject({ ageDays: 90, recencyWeightBasisPoints: 5_500 })
    expect(() =>
      calculateDashboardWeakness(
        typeCandidate({ lastAnsweredAt: daysAgo(90, 1) }),
        observedAt
      )
    ).toThrowError(DashboardInsightCalculationError)
    expect(() =>
      calculateDashboardWeakness(
        typeCandidate({
          lastAnsweredAt: new Date(observedAt.getTime() + 1)
        }),
        observedAt
      )
    ).toThrowError(DashboardInsightCalculationError)
  })

  it('bounded top-N에서 exact ratio와 stable key tie-break를 사용한다', () => {
    const selected = selectTopDashboardWeaknesses(
      [
        tagCandidate('z', { attemptedCount: 10, incorrectCount: 5 }),
        tagCandidate('b'),
        tagCandidate('a')
      ],
      observedAt,
      2
    )
    expect(selected.map(({ key }) => key)).toEqual([
      'TAG|N2|GRAMMAR|z',
      'TAG|N2|GRAMMAR|a'
    ])
    expect(() =>
      selectTopDashboardWeaknesses(
        [typeCandidate(), typeCandidate()],
        observedAt,
        5
      )
    ).toThrowError(DashboardInsightCalculationError)

    const left = calculateDashboardWeakness(tagCandidate('a'), observedAt)
    const right = calculateDashboardWeakness(tagCandidate('b'), observedAt)
    const third = calculateDashboardWeakness(tagCandidate('c'), observedAt)
    if (!left || !right || !third) {
      throw new Error('tag fixtures must produce scored weaknesses')
    }
    expect(Math.sign(compareDashboardWeaknesses(left, right))).toBe(
      -Math.sign(compareDashboardWeaknesses(right, left))
    )
    expect(compareDashboardWeaknesses(left, right)).toBeLessThan(0)
    expect(compareDashboardWeaknesses(right, third)).toBeLessThan(0)
    expect(compareDashboardWeaknesses(left, third)).toBeLessThan(0)
  })

  it('canonical weakness identity와 level-aware taxonomy를 fail closed한다', () => {
    expect(() =>
      calculateDashboardWeakness(
        typeCandidate({ key: 'caller-key' }),
        observedAt
      )
    ).toThrowError(DashboardInsightCalculationError)
    expect(() =>
      calculateDashboardWeakness(
        typeCandidate({
          key: 'QUESTION_TYPE|N5|READING|LONG_READING',
          level: 'N5',
          subject: 'READING',
          questionType: 'LONG_READING'
        }),
        observedAt
      )
    ).toThrowError(DashboardInsightCalculationError)
  })

  it('due→repeated→recent type→stale subject→target 순서와 dedupe를 고정한다', () => {
    const result = buildDashboardRecommendations({
      targetLevel: 'N2',
      dueGroups: [
        {
          level: 'N2',
          subject: 'GRAMMAR',
          dueCount: 1,
          earliestDueAt: daysAgo(3)
        }
      ],
      repeatedWrongCandidates: [
        {
          isDue: true,
          questionId: 'due-question',
          level: 'N2',
          subject: 'GRAMMAR',
          questionPreview: 'due와 겹치는 문제',
          wrongCount: 9,
          status: 'AGAIN',
          lastWrongAt: daysAgo(1)
        },
        {
          isDue: false,
          questionId: 'repeat-question',
          level: 'N2',
          subject: 'VOCABULARY',
          questionPreview: '반복 오답 문제',
          wrongCount: 3,
          status: 'AGAIN',
          lastWrongAt: daysAgo(2)
        }
      ],
      weaknesses: [score(typeCandidate()), score(subjectCandidate())],
      actionableWeaknessCandidateCountByLevelSubject: new Map([
        [createLevelSubjectKey('N2', 'GRAMMAR'), 7],
        [createLevelSubjectKey('N2', 'READING'), 3]
      ]),
      targetPracticeCandidates: [
        {
          level: 'N2',
          subject: 'VOCABULARY',
          catalogCount: 22,
          nonRecentCount: 18,
          lastStudiedAt: null
        }
      ]
    })

    expect(result.recommendations.map(({ kind }) => kind)).toEqual([
      'DUE_REVIEW',
      'REPEATED_WRONG',
      'RECENT_LOW_ACCURACY_TYPE',
      'STALE_WEAK_SUBJECT',
      'TARGET_LEVEL_PRACTICE'
    ])
    expect(result.recommendations.map(({ rank }) => rank)).toEqual([
      1, 2, 3, 4, 5
    ])
    expect(result.recommendations[1]).toMatchObject({
      action: { questionId: 'repeat-question' }
    })
    expect(result.personalizationFallbackReason).toBeNull()
  })

  it('실제 WEAKNESS 후보가 없는 신호를 건너뛰고 명시적 fallback을 만든다', () => {
    const noTarget = buildDashboardRecommendations({
      targetLevel: null,
      dueGroups: [],
      repeatedWrongCandidates: [],
      weaknesses: [score(typeCandidate()), score(subjectCandidate())],
      actionableWeaknessCandidateCountByLevelSubject: new Map(),
      targetPracticeCandidates: []
    })
    expect(noTarget).toMatchObject({
      personalizationFallbackReason: 'TARGET_LEVEL_NOT_SET',
      recommendations: [
        {
          rank: 1,
          kind: 'PRACTICE_SETUP',
          reason: { code: 'TARGET_LEVEL_NOT_SET' }
        }
      ]
    })

    const targetOnly = buildDashboardRecommendations({
      targetLevel: 'N3',
      dueGroups: [],
      repeatedWrongCandidates: [],
      weaknesses: [],
      actionableWeaknessCandidateCountByLevelSubject: new Map(),
      targetPracticeCandidates: [
        {
          level: 'N3',
          subject: 'GRAMMAR',
          catalogCount: 4,
          nonRecentCount: 4,
          lastStudiedAt: null
        }
      ]
    })
    expect(targetOnly.personalizationFallbackReason).toBe(
      'NO_PERSONALIZED_EVIDENCE'
    )
    expect(targetOnly.recommendations).toMatchObject([
      {
        kind: 'TARGET_LEVEL_PRACTICE',
        action: { count: 5, mode: 'RANDOM' }
      }
    ])
  })

  it('목표 급수 null lastStudiedAt tie를 남은 stable 기준으로 판정한다', () => {
    const result = buildDashboardRecommendations({
      targetLevel: 'N3',
      dueGroups: [],
      repeatedWrongCandidates: [],
      weaknesses: [],
      actionableWeaknessCandidateCountByLevelSubject: new Map(),
      targetPracticeCandidates: [
        {
          level: 'N3',
          subject: 'READING',
          catalogCount: 2,
          nonRecentCount: 1,
          lastStudiedAt: null
        },
        {
          level: 'N3',
          subject: 'VOCABULARY',
          catalogCount: 20,
          nonRecentCount: 20,
          lastStudiedAt: null
        }
      ]
    })

    expect(result.recommendations).toMatchObject([
      {
        action: {
          level: 'N3',
          subject: 'VOCABULARY',
          count: 20
        }
      }
    ])
  })

  it('due group과 repeated candidate identity 중복을 fail closed한다', () => {
    const base = {
      targetLevel: null,
      repeatedWrongCandidates: [],
      weaknesses: [],
      actionableWeaknessCandidateCountByLevelSubject: new Map(),
      targetPracticeCandidates: []
    } as const
    expect(() =>
      buildDashboardRecommendations({
        ...base,
        dueGroups: [
          {
            level: 'N2',
            subject: 'GRAMMAR',
            dueCount: 1,
            earliestDueAt: daysAgo(1)
          },
          {
            level: 'N2',
            subject: 'GRAMMAR',
            dueCount: 1,
            earliestDueAt: daysAgo(2)
          }
        ]
      })
    ).toThrowError(DashboardInsightCalculationError)
    expect(() =>
      buildDashboardRecommendations({
        ...base,
        dueGroups: [],
        repeatedWrongCandidates: [
          {
            isDue: false,
            questionId: 'same',
            level: 'N2',
            subject: 'GRAMMAR',
            questionPreview: '중복',
            wrongCount: 2,
            status: 'AGAIN',
            lastWrongAt: daysAgo(1)
          },
          {
            isDue: false,
            questionId: 'same',
            level: 'N2',
            subject: 'GRAMMAR',
            questionPreview: '중복',
            wrongCount: 3,
            status: 'AGAIN',
            lastWrongAt: daysAgo(2)
          }
        ]
      })
    ).toThrowError(DashboardInsightCalculationError)
    expect(() =>
      buildDashboardRecommendations({
        ...base,
        dueGroups: [],
        targetLevel: 'N2',
        targetPracticeCandidates: [
          {
            level: 'N2',
            subject: 'GRAMMAR',
            catalogCount: 1,
            nonRecentCount: 1,
            lastStudiedAt: null
          },
          {
            level: 'N2',
            subject: 'GRAMMAR',
            catalogCount: 2,
            nonRecentCount: 2,
            lastStudiedAt: null
          }
        ]
      })
    ).toThrowError(DashboardInsightCalculationError)
    expect(() =>
      buildDashboardRecommendations({
        ...base,
        dueGroups: [],
        targetLevel: 'N3',
        targetPracticeCandidates: [
          {
            level: 'N3',
            subject: 'READING',
            catalogCount: 1,
            nonRecentCount: 2,
            lastStudiedAt: null
          }
        ]
      })
    ).toThrowError(DashboardInsightCalculationError)
  })

  it('setup count를 기존 5/10/20 선택지로 올림한다', () => {
    expect(toDashboardSetupCount(1)).toBe(5)
    expect(toDashboardSetupCount(6)).toBe(5)
    expect(toDashboardSetupCount(9)).toBe(5)
    expect(toDashboardSetupCount(10)).toBe(10)
    expect(toDashboardSetupCount(11)).toBe(10)
    expect(toDashboardSetupCount(19)).toBe(10)
    expect(toDashboardSetupCount(20)).toBe(20)
    expect(toDashboardSetupCount(200)).toBe(20)
    expect(() => toDashboardSetupCount(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      DashboardInsightCalculationError
    )
  })
})

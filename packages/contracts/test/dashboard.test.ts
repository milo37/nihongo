import { describe, expect, it } from 'vitest'
import {
  getDashboardStatsErrorSchema,
  getDashboardStatsQuerySchema,
  getDashboardStatsResponseSchema,
  dashboardSubjectStatSchema
} from '../src/dashboard/get-dashboard-stats.js'

const id = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${index.toString(16).padStart(12, '0')}`

const emptyDashboard = {
  totalAnsweredCount: 0,
  correctCount: 0,
  correctRate: 0,
  wrongNoteCount: 0,
  solvedWrongNoteCount: 0,
  weakestSubject: null,
  subjectStats: [
    {
      subject: 'VOCABULARY',
      answeredCount: 0,
      correctCount: 0,
      correctRate: 0
    },
    {
      subject: 'GRAMMAR',
      answeredCount: 0,
      correctCount: 0,
      correctRate: 0
    },
    {
      subject: 'READING',
      answeredCount: 0,
      correctCount: 0,
      correctRate: 0
    }
  ],
  recentStudySessions: [],
  dailyStudyCountLast7Days: Array.from({ length: 7 }, (_, index) => ({
    date: `2026-08-${(10 + index).toString().padStart(2, '0')}`,
    count: 0
  })),
  repeatedWrongQuestions: []
} as const

describe('dashboard contracts', () => {
  it('UTC inclusive range를 both-or-none·순서·최대 366일로 고정한다', () => {
    expect(getDashboardStatsQuerySchema.parse({})).toEqual({})
    expect(
      getDashboardStatsQuerySchema.parse({
        from: '2024-01-01',
        to: '2024-12-31'
      })
    ).toEqual({ from: '2024-01-01', to: '2024-12-31' })

    for (const invalid of [
      { from: '2026-08-01' },
      { to: '2026-08-01' },
      { from: '2026-08-02', to: '2026-08-01' },
      { from: '2024-01-01', to: '2025-01-01' },
      { from: '2025-02-29', to: '2025-03-01' },
      { from: '2026-08-01', to: '2026-08-02', userId: id(90) }
    ]) {
      expect(getDashboardStatsQuerySchema.safeParse(invalid).success).toBe(
        false
      )
    }
  })

  it('빈 authoritative aggregate와 정확히 7개의 연속 UTC 날짜를 허용한다', () => {
    expect(getDashboardStatsResponseSchema.parse(emptyDashboard)).toEqual(
      emptyDashboard
    )

    expect(
      getDashboardStatsResponseSchema.safeParse({
        ...emptyDashboard,
        dailyStudyCountLast7Days:
          emptyDashboard.dailyStudyCountLast7Days.slice(1)
      }).success
    ).toBe(false)
    expect(
      getDashboardStatsResponseSchema.safeParse({
        ...emptyDashboard,
        dailyStudyCountLast7Days: emptyDashboard.dailyStudyCountLast7Days.map(
          (daily, index) =>
            index === 3 ? { ...daily, date: '2026-08-20' } : daily
        )
      }).success
    ).toBe(false)
  })

  it('basis-point 반올림과 최소 3문항·고정 subject tie-break를 검증한다', () => {
    expect(
      dashboardSubjectStatSchema.safeParse({
        subject: 'VOCABULARY',
        answeredCount: 6,
        correctCount: 1,
        correctRate: 16.67
      }).success
    ).toBe(true)
    expect(
      dashboardSubjectStatSchema.safeParse({
        subject: 'VOCABULARY',
        answeredCount: 10_000,
        correctCount: 7,
        correctRate: 0.07
      }).success
    ).toBe(true)
    const dashboard = {
      ...emptyDashboard,
      totalAnsweredCount: 9,
      correctCount: 4,
      correctRate: 44.44,
      weakestSubject: 'VOCABULARY',
      subjectStats: [
        {
          subject: 'VOCABULARY',
          answeredCount: 3,
          correctCount: 1,
          correctRate: 33.33
        },
        {
          subject: 'GRAMMAR',
          answeredCount: 3,
          correctCount: 1,
          correctRate: 33.33
        },
        {
          subject: 'READING',
          answeredCount: 3,
          correctCount: 2,
          correctRate: 66.67
        }
      ]
    }

    expect(getDashboardStatsResponseSchema.safeParse(dashboard).success).toBe(
      true
    )
    expect(
      getDashboardStatsResponseSchema.safeParse({
        ...dashboard,
        correctRate: 44
      }).success
    ).toBe(false)
    expect(
      getDashboardStatsResponseSchema.safeParse({
        ...dashboard,
        weakestSubject: 'GRAMMAR'
      }).success
    ).toBe(false)
  })

  it('recent RANDOM·repeat count·strict private projection을 고정한다', () => {
    const dashboard = {
      ...emptyDashboard,
      wrongNoteCount: 1,
      recentStudySessions: [
        {
          id: id(1),
          level: 'N5',
          subject: 'VOCABULARY',
          mode: 'RANDOM',
          totalCount: 3,
          correctCount: 1,
          correctRate: 33.33,
          durationSec: 30,
          submittedAt: '2026-08-16T10:00:00.000Z'
        }
      ],
      repeatedWrongQuestions: [
        {
          questionId: id(2),
          questionPreview: '역사적 마지막 오답 문제',
          level: 'N5',
          subject: 'VOCABULARY',
          wrongCount: 2,
          status: 'AGAIN'
        }
      ]
    }

    expect(getDashboardStatsResponseSchema.safeParse(dashboard).success).toBe(
      true
    )

    for (const invalid of [
      { ...dashboard, userId: id(90) },
      {
        ...dashboard,
        recentStudySessions: [
          { ...dashboard.recentStudySessions[0], mode: 'WRONG_NOTE' }
        ]
      },
      {
        ...dashboard,
        repeatedWrongQuestions: [
          { ...dashboard.repeatedWrongQuestions[0], memo: 'private' }
        ]
      },
      {
        ...dashboard,
        repeatedWrongQuestions: [
          {
            ...dashboard.repeatedWrongQuestions[0],
            questionPreview: '𠮷'.repeat(161)
          }
        ]
      }
    ]) {
      expect(getDashboardStatsResponseSchema.safeParse(invalid).success).toBe(
        false
      )
    }
  })

  it('operation별 error code를 닫힌 집합으로 유지한다', () => {
    const failure = {
      message: '요청을 처리할 수 없습니다.',
      requestId: id(80),
      retryable: false
    }
    expect(
      getDashboardStatsErrorSchema.safeParse({
        ...failure,
        code: 'AUTH_SESSION_EXPIRED'
      }).success
    ).toBe(true)
    expect(
      getDashboardStatsErrorSchema.safeParse({
        ...failure,
        code: 'RESOURCE_NOT_FOUND'
      }).success
    ).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  calculateDashboardRate,
  DashboardMapperIntegrityError,
  toDashboardStats,
  toSafeDashboardCount
} from './dashboardMapper.js'
import type { DashboardSnapshotRecord } from './dashboardRepository.js'

const SESSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10d1'
const QUESTION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'

const snapshot = (
  overrides: Partial<DashboardSnapshotRecord> = {}
): DashboardSnapshotRecord => ({
  subjectStats: [],
  recentSessions: [],
  dailyCounts: [],
  noteCounts: { totalCount: 0n, solvedCount: 0n },
  repeatedWrongQuestions: [],
  ...overrides
})

describe('Dashboard mapper', () => {
  it('BigInt count에서 exact basis-point 반올림을 계산한다', () => {
    expect(calculateDashboardRate(1n, 6n)).toBe(16.67)
    expect(calculateDashboardRate(2n, 3n)).toBe(66.67)
    expect(calculateDashboardRate(0n, 0n)).toBe(0)
    expect(calculateDashboardRate(1n, 3n)).toBe(33.33)
  })

  it('unsafe bigint와 invalid count 관계를 fail closed한다', () => {
    expect(() =>
      toSafeDashboardCount(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'count')
    ).toThrow(DashboardMapperIntegrityError)
    expect(() => calculateDashboardRate(4n, 3n)).toThrow(
      DashboardMapperIntegrityError
    )
  })

  it('subject zero-fill·min3·고정 tie와 UTC 7일 zero-fill을 고정한다', () => {
    const response = toDashboardStats(
      snapshot({
        subjectStats: [
          { subject: 'READING', answeredCount: 3n, correctCount: 1n },
          { subject: 'VOCABULARY', answeredCount: 3n, correctCount: 1n }
        ],
        dailyCounts: [
          { date: '2026-08-10', count: 2n },
          { date: '2026-08-16', count: 5n }
        ],
        noteCounts: { totalCount: 2n, solvedCount: 1n }
      }),
      '2026-08-16'
    )

    expect(response.subjectStats).toEqual([
      {
        subject: 'VOCABULARY',
        answeredCount: 3,
        correctCount: 1,
        correctRate: 33.33
      },
      {
        subject: 'GRAMMAR',
        answeredCount: 0,
        correctCount: 0,
        correctRate: 0
      },
      {
        subject: 'READING',
        answeredCount: 3,
        correctCount: 1,
        correctRate: 33.33
      }
    ])
    expect(response.weakestSubject).toBe('VOCABULARY')
    expect(response.totalAnsweredCount).toBe(6)
    expect(response.correctCount).toBe(2)
    expect(response.correctRate).toBe(33.33)
    expect(response.dailyStudyCountLast7Days).toEqual([
      { date: '2026-08-10', count: 2 },
      { date: '2026-08-11', count: 0 },
      { date: '2026-08-12', count: 0 },
      { date: '2026-08-13', count: 0 },
      { date: '2026-08-14', count: 0 },
      { date: '2026-08-15', count: 0 },
      { date: '2026-08-16', count: 5 }
    ])
  })

  it('recent stored basis points와 repeated Unicode preview를 검증한다', () => {
    const response = toDashboardStats(
      snapshot({
        recentSessions: [
          {
            id: SESSION_ID,
            level: 'N5',
            subject: 'VOCABULARY',
            mode: 'RANDOM',
            totalCount: 6,
            correctCount: 1,
            correctRateBasisPoints: 1667,
            durationSec: 60,
            submittedAt: new Date('2026-08-16T00:00:00.000Z')
          }
        ],
        noteCounts: { totalCount: 1n, solvedCount: 0n },
        repeatedWrongQuestions: [
          {
            questionId: QUESTION_ID,
            questionText: '😀'.repeat(161),
            level: 'N5',
            subject: 'VOCABULARY',
            wrongCount: 4,
            status: 'AGAIN',
            lastWrongAt: new Date('2026-08-16T00:00:00.000Z')
          }
        ]
      }),
      '2026-08-16'
    )

    expect(response.recentStudySessions[0]?.correctRate).toBe(16.67)
    expect([
      ...(response.repeatedWrongQuestions[0]?.questionPreview ?? '')
    ]).toHaveLength(160)

    expect(() =>
      toDashboardStats(
        snapshot({
          recentSessions: [
            {
              id: SESSION_ID,
              level: 'N5',
              subject: 'VOCABULARY',
              mode: 'RANDOM',
              totalCount: 6,
              correctCount: 1,
              correctRateBasisPoints: 1666,
              durationSec: 60,
              submittedAt: new Date('2026-08-16T00:00:00.000Z')
            }
          ]
        }),
        '2026-08-16'
      )
    ).toThrow(DashboardMapperIntegrityError)
  })
})

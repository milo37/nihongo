import type {
  DashboardRecentStudySession,
  DashboardRepeatedWrongQuestion,
  DashboardSubjectStat,
  GetDashboardStatsResponse
} from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { createWrongNoteQuestionPreview } from '../wrong-note/wrongNoteMapper.js'
import type {
  DashboardDailyAggregateRecord,
  DashboardRecentSessionRecord,
  DashboardSnapshotRecord,
  DashboardSubjectAggregateRecord
} from './dashboardRepository.js'

const SUBJECTS = ['VOCABULARY', 'GRAMMAR', 'READING'] as const

export class DashboardMapperIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DashboardMapperIntegrityError'
  }
}

export const toSafeDashboardCount = (value: bigint, field: string): number => {
  const converted = Number(value)
  if (
    value < 0n ||
    !Number.isSafeInteger(converted) ||
    BigInt(converted) !== value
  ) {
    throw new DashboardMapperIntegrityError(
      `${field} exceeds the safe integer range.`
    )
  }
  return converted
}

export const calculateDashboardRate = (
  correctCount: bigint,
  answeredCount: bigint
): number => {
  if (correctCount < 0n || answeredCount < 0n || correctCount > answeredCount) {
    throw new DashboardMapperIntegrityError(
      'Dashboard correct count exceeds the answered count.'
    )
  }
  if (answeredCount === 0n) {
    return 0
  }

  const basisPoints =
    (correctCount * 10_000n + answeredCount / 2n) / answeredCount
  return Number(basisPoints) / 100
}

const toUtcCalendarDate = (value: Date): string =>
  value.toISOString().slice(0, 10)

const addUtcDays = (calendarDate: string, days: number): string => {
  const value = new Date(`${calendarDate}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return toUtcCalendarDate(value)
}

const toSubjectStats = (
  rows: readonly DashboardSubjectAggregateRecord[]
): DashboardSubjectStat[] => {
  const bySubject = new Map<
    DashboardSubjectStat['subject'],
    DashboardSubjectAggregateRecord
  >()
  for (const row of rows) {
    if (bySubject.has(row.subject)) {
      throw new DashboardMapperIntegrityError(
        'Dashboard subject aggregate contains duplicate rows.'
      )
    }
    bySubject.set(row.subject, row)
  }

  return SUBJECTS.map((subject) => {
    const row = bySubject.get(subject)
    const answeredCount = row?.answeredCount ?? 0n
    const correctCount = row?.correctCount ?? 0n
    return {
      subject,
      answeredCount: toSafeDashboardCount(
        answeredCount,
        `${subject}.answeredCount`
      ),
      correctCount: toSafeDashboardCount(
        correctCount,
        `${subject}.correctCount`
      ),
      correctRate: calculateDashboardRate(correctCount, answeredCount)
    }
  })
}

const toRecentSession = (
  record: DashboardRecentSessionRecord
): DashboardRecentStudySession => {
  if (
    !Number.isSafeInteger(record.totalCount) ||
    !Number.isSafeInteger(record.correctCount) ||
    !Number.isSafeInteger(record.durationSec)
  ) {
    throw new DashboardMapperIntegrityError(
      'Recent StudySession contains an unsafe integer.'
    )
  }
  const totalCount = BigInt(record.totalCount)
  const correctCount = BigInt(record.correctCount)
  const correctRate = calculateDashboardRate(correctCount, totalCount)
  if (record.correctRateBasisPoints !== Math.round(correctRate * 100)) {
    throw new DashboardMapperIntegrityError(
      'Recent StudyResult basis points do not match its counts.'
    )
  }

  return {
    id: record.id,
    level: record.level,
    subject: record.subject,
    mode: record.mode,
    totalCount: record.totalCount,
    correctCount: record.correctCount,
    correctRate,
    durationSec: record.durationSec,
    submittedAt: record.submittedAt.toISOString()
  }
}

const toDailyCounts = (
  rows: readonly DashboardDailyAggregateRecord[],
  anchorDate: string
): GetDashboardStatsResponse['dailyStudyCountLast7Days'] => {
  const expectedDates = Array.from({ length: 7 }, (_, index) =>
    addUtcDays(anchorDate, index - 6)
  )
  const expectedDateSet = new Set(expectedDates)
  const countByDate = new Map<string, bigint>()

  for (const row of rows) {
    if (countByDate.has(row.date) || !expectedDateSet.has(row.date)) {
      throw new DashboardMapperIntegrityError(
        `Dashboard daily aggregate contains an unexpected date: ${row.date}.`
      )
    }
    countByDate.set(row.date, row.count)
  }

  return expectedDates.map((date) => ({
    date,
    count: toSafeDashboardCount(countByDate.get(date) ?? 0n, `daily.${date}`)
  }))
}

const toRepeatedWrongQuestion = (
  record: DashboardSnapshotRecord['repeatedWrongQuestions'][number]
): DashboardRepeatedWrongQuestion => {
  if (!Number.isSafeInteger(record.wrongCount) || record.wrongCount < 1) {
    throw new DashboardMapperIntegrityError(
      'Repeated WrongNote count is outside the safe integer range.'
    )
  }
  return {
    questionId: record.questionId,
    questionPreview: createWrongNoteQuestionPreview(record.questionText),
    level: record.level,
    subject: record.subject,
    wrongCount: record.wrongCount,
    status: record.status
  }
}

export const toDashboardStats = (
  record: DashboardSnapshotRecord,
  anchorDate: string
): GetDashboardStatsResponse => {
  const subjectStats = toSubjectStats(record.subjectStats)
  const totalAnsweredCountBigInt = record.subjectStats.reduce(
    (total, stat) => total + stat.answeredCount,
    0n
  )
  const correctCountBigInt = record.subjectStats.reduce(
    (total, stat) => total + stat.correctCount,
    0n
  )
  const totalAnsweredCount = toSafeDashboardCount(
    totalAnsweredCountBigInt,
    'totalAnsweredCount'
  )
  const correctCount = toSafeDashboardCount(correctCountBigInt, 'correctCount')
  const weakestSubject = subjectStats.reduce<
    DashboardSubjectStat['subject'] | null
  >((weakest, stat) => {
    if (stat.answeredCount < 3) {
      return weakest
    }
    if (weakest === null) {
      return stat.subject
    }
    const weakestStat = subjectStats.find(
      (candidate) => candidate.subject === weakest
    )
    return weakestStat && stat.correctRate < weakestStat.correctRate
      ? stat.subject
      : weakest
  }, null)

  return {
    totalAnsweredCount,
    correctCount,
    correctRate: calculateDashboardRate(
      correctCountBigInt,
      totalAnsweredCountBigInt
    ),
    wrongNoteCount: toSafeDashboardCount(
      record.noteCounts.totalCount,
      'wrongNoteCount'
    ),
    solvedWrongNoteCount: toSafeDashboardCount(
      record.noteCounts.solvedCount,
      'solvedWrongNoteCount'
    ),
    weakestSubject,
    subjectStats,
    recentStudySessions: record.recentSessions.map(toRecentSession),
    dailyStudyCountLast7Days: toDailyCounts(record.dailyCounts, anchorDate),
    repeatedWrongQuestions: record.repeatedWrongQuestions.map(
      toRepeatedWrongQuestion
    )
  }
}

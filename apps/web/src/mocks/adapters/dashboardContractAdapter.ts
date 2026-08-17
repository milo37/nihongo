import type {
  GetDashboardStatsResponse,
  ParsedGetDashboardStatsQuery
} from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { isoDateTimeSchema } from '@nihongo/contracts/common/date'
import { getContractQuestionId } from '@mocks/adapters/questionContractAdapter'
import { createMockWrongNoteQuestionPreview } from '@mocks/adapters/wrongNoteReadContractAdapter'
import type {
  MockCanonicalDashboardRecord,
  MockCanonicalDashboardSessionRecord,
  MockCanonicalWrongNoteRecord
} from '@mocks/repository/mockDatabase'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000
const SUBJECTS = ['VOCABULARY', 'GRAMMAR', 'READING'] as const

export class MockDashboardIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MockDashboardIntegrityError'
  }
}

const toSafeCount = (value: bigint, field: string): number => {
  const number = Number(value)
  if (value < 0n || !Number.isSafeInteger(number) || BigInt(number) !== value) {
    throw new MockDashboardIntegrityError(
      `${field} exceeds the safe integer range.`
    )
  }
  return number
}

const calculateRate = (correct: bigint, answered: bigint): number => {
  if (correct < 0n || answered < 0n || correct > answered) {
    throw new MockDashboardIntegrityError(
      'Dashboard correct count exceeds the answered count.'
    )
  }
  if (answered === 0n) {
    return 0
  }

  return Number((correct * 10_000n + answered / 2n) / answered) / 100
}

const parseUtcDate = (date: string): number =>
  Date.parse(`${date}T00:00:00.000Z`)

const parseIsoTime = (value: string, field: string): number => {
  const parsed = isoDateTimeSchema.safeParse(value)
  if (!parsed.success) {
    throw new MockDashboardIntegrityError(`${field} is not a valid instant.`)
  }
  return Date.parse(parsed.data)
}

const toUtcCalendarDate = (value: string, field: string): string =>
  new Date(parseIsoTime(value, field)).toISOString().slice(0, 10)

const addUtcDays = (date: string, days: number): string =>
  new Date(parseUtcDate(date) + days * DAY_MILLISECONDS)
    .toISOString()
    .slice(0, 10)

const isInActivityRange = (
  submittedAt: string,
  query: ParsedGetDashboardStatsQuery
): boolean => {
  if (!query.from || !query.to) {
    return true
  }

  const submittedAtMs = parseIsoTime(submittedAt, 'submittedAt')
  return (
    submittedAtMs >= parseUtcDate(query.from) &&
    submittedAtMs < parseUtcDate(query.to) + DAY_MILLISECONDS
  )
}

const toRecentSession = (record: MockCanonicalDashboardSessionRecord) => ({
  id: record.id,
  level: record.level,
  subject: record.subject,
  mode: 'RANDOM' as const,
  totalCount: record.totalCount,
  correctCount: record.correctCount,
  correctRate: calculateRate(
    BigInt(record.correctCount),
    BigInt(record.totalCount)
  ),
  durationSec: record.durationSec,
  submittedAt: new Date(
    parseIsoTime(record.submittedAt, 'recentStudySessions.submittedAt')
  ).toISOString()
})

const toRepeatedWrongQuestion = (record: MockCanonicalWrongNoteRecord) => ({
  questionId: getContractQuestionId(record.sourceQuestionId),
  questionPreview: createMockWrongNoteQuestionPreview(
    record.lastWrongQuestion.questionText
  ),
  level: record.lastWrongQuestion.level,
  subject: record.lastWrongQuestion.subject,
  wrongCount: record.wrongCount,
  status: record.status
})

export const toContractDashboardStats = (
  record: MockCanonicalDashboardRecord,
  query: ParsedGetDashboardStatsQuery
): GetDashboardStatsResponse => {
  const activitySessions = record.sessions.filter((session) =>
    isInActivityRange(session.submittedAt, query)
  )
  const subjectStats = SUBJECTS.map((subject) => {
    const sessions = activitySessions.filter(
      (session) => session.subject === subject
    )
    const answered = sessions.reduce(
      (total, session) => total + BigInt(session.totalCount),
      0n
    )
    const correct = sessions.reduce(
      (total, session) => total + BigInt(session.correctCount),
      0n
    )

    return {
      subject,
      answeredCount: toSafeCount(answered, `${subject}.answeredCount`),
      correctCount: toSafeCount(correct, `${subject}.correctCount`),
      correctRate: calculateRate(correct, answered)
    }
  })
  const totalAnswered = subjectStats.reduce(
    (total, stat) => total + BigInt(stat.answeredCount),
    0n
  )
  const correct = subjectStats.reduce(
    (total, stat) => total + BigInt(stat.correctCount),
    0n
  )
  const weakestSubject = subjectStats.reduce<(typeof SUBJECTS)[number] | null>(
    (weakest, stat) => {
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
    },
    null
  )
  const anchorDate =
    query.to ?? toUtcCalendarDate(record.observedAt, 'observedAt')
  const dailyDates = Array.from({ length: 7 }, (_, index) =>
    addUtcDays(anchorDate, index - 6)
  )
  const dailyCountByDate = new Map(dailyDates.map((date) => [date, 0n]))
  for (const session of activitySessions) {
    const date = toUtcCalendarDate(session.submittedAt, 'submittedAt')
    if (dailyCountByDate.has(date)) {
      dailyCountByDate.set(
        date,
        (dailyCountByDate.get(date) ?? 0n) + BigInt(session.totalCount)
      )
    }
  }

  return {
    totalAnsweredCount: toSafeCount(totalAnswered, 'totalAnsweredCount'),
    correctCount: toSafeCount(correct, 'correctCount'),
    correctRate: calculateRate(correct, totalAnswered),
    wrongNoteCount: record.wrongNotes.length,
    solvedWrongNoteCount: record.wrongNotes.filter(
      ({ status }) => status === 'SOLVED'
    ).length,
    weakestSubject,
    subjectStats,
    recentStudySessions: activitySessions
      .toSorted(
        (left, right) =>
          parseIsoTime(right.submittedAt, 'submittedAt') -
            parseIsoTime(left.submittedAt, 'submittedAt') ||
          left.id.localeCompare(right.id)
      )
      .slice(0, 5)
      .map(toRecentSession),
    dailyStudyCountLast7Days: dailyDates.map((date) => ({
      date,
      count: toSafeCount(dailyCountByDate.get(date) ?? 0n, `daily.${date}`)
    })),
    repeatedWrongQuestions: record.wrongNotes
      .toSorted(
        (left, right) =>
          right.wrongCount - left.wrongCount ||
          right.lastWrongAt.localeCompare(left.lastWrongAt) ||
          left.wrongNoteId.localeCompare(right.wrongNoteId)
      )
      .slice(0, 5)
      .map(toRepeatedWrongQuestion)
  }
}

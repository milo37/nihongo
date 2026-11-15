import { Prisma } from '../generated/prisma/client.js'
import { nextGuestDayStart, startOfGuestDay } from './guestDay.js'

/**
 * How many new random sets one member may start (#1006). Only RANDOM sets
 * draw new questions, so wrong-note, weakness, bookmark and review sets and
 * result retries are not counted. The numbers stay on the server so the
 * browser never shows them.
 */
export const MEMBER_HOURLY_RANDOM_SESSION_LIMIT = 20
export const MEMBER_DAILY_RANDOM_SESSION_LIMIT = 60
/** A day this busy is logged for the operator; the member is not stopped. */
export const MEMBER_DAILY_ALERT_SESSIONS = 30
export const MEMBER_DAILY_ALERT_QUESTIONS = 400

const HOUR_MS = 60 * 60 * 1_000

export class MemberSessionCapReachedError extends Error {
  constructor(
    readonly window: 'HOUR' | 'DAY',
    readonly resetsAt: Date
  ) {
    super('The member started its random session limit.')
    this.name = 'MemberSessionCapReachedError'
  }
}

/** Today's random sets and their questions before the new one. */
export interface MemberDailyVolume {
  readonly sessions: number
  readonly questions: number
}

/**
 * Refuses a member's new random set past the hourly (last 60 minutes) or
 * daily (Korea-time day) limit. The lock makes two starts of one member at
 * once count one by one.
 */
export const assertMemberSessionCap = async (
  transaction: Prisma.TransactionClient,
  userId: string,
  startedAt: Date
): Promise<MemberDailyVolume> => {
  await transaction.$queryRaw(Prisma.sql`
    SELECT 1 AS "locked"
    FROM (
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`study-session-cap:${userId}`}, 0)
      )
    ) AS acquired`)
  const hourStart = new Date(startedAt.getTime() - HOUR_MS)
  const dayStart = startOfGuestDay(startedAt)
  const windowStart = hourStart < dayStart ? hourStart : dayStart
  // Sets of a later day never count, so a back-dated start sees its own day.
  const dayEnd = nextGuestDayStart(startedAt)
  const [row] = await transaction.$queryRaw<
    Array<{
      hourly: number
      oldest: Date | null
      daily: number
      questions: number
    }>
  >(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE "startedAt" > ${hourStart}::timestamptz)::int AS "hourly",
      min("startedAt") FILTER (WHERE "startedAt" > ${hourStart}::timestamptz) AS "oldest",
      count(*) FILTER (WHERE "startedAt" >= ${dayStart}::timestamptz)::int AS "daily",
      COALESCE(
        sum("actualCount") FILTER (WHERE "startedAt" >= ${dayStart}::timestamptz),
        0
      )::int AS "questions"
    FROM "StudySession"
    WHERE "userId" = ${userId}::uuid
      AND "mode" = 'RANDOM'
      AND "retryOfStudySessionId" IS NULL
      AND "startedAt" >= ${windowStart}::timestamptz
      AND "startedAt" < ${dayEnd}::timestamptz`)
  const daily = row?.daily ?? 0
  const hourly = row?.hourly ?? 0
  if (daily >= MEMBER_DAILY_RANDOM_SESSION_LIMIT) {
    throw new MemberSessionCapReachedError('DAY', dayEnd)
  }
  if (hourly >= MEMBER_HOURLY_RANDOM_SESSION_LIMIT && row?.oldest) {
    throw new MemberSessionCapReachedError(
      'HOUR',
      new Date(row.oldest.getTime() + HOUR_MS)
    )
  }
  return { sessions: daily, questions: row?.questions ?? 0 }
}

/** Which alert line, if any, the new set crossed today. */
export const crossedMemberDailyAlert = (
  before: MemberDailyVolume,
  addedQuestions: number
): 'SESSIONS' | 'QUESTIONS' | null => {
  if (
    before.sessions < MEMBER_DAILY_ALERT_SESSIONS &&
    before.sessions + 1 >= MEMBER_DAILY_ALERT_SESSIONS
  ) {
    return 'SESSIONS'
  }
  if (
    before.questions < MEMBER_DAILY_ALERT_QUESTIONS &&
    before.questions + addedQuestions >= MEMBER_DAILY_ALERT_QUESTIONS
  ) {
    return 'QUESTIONS'
  }
  return null
}

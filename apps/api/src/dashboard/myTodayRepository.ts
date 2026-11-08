import { listReviewQueueQuerySchema } from '@nihongo/contracts/wrong-note/list-review-queue'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { createReviewQueueCountsQuery } from '../wrong-note/wrongNoteReviewQueueRepository.js'

/** Facts for the learner home "my today" card (#773), read in one snapshot. */
export interface MyTodaySnapshotRecord {
  /** Studied-day run that ends latest, in Korea calendar days; null before the first submit. */
  readonly latestStreak: {
    readonly lastDay: string
    readonly length: number
  } | null
  readonly observedAt: Date
  readonly reviewDueCount: number
  readonly today: string
  readonly todayAnsweredCount: number
}

export interface MyTodayRepository {
  /** Reads at the database clock unless a test pins `observedAt`. */
  readOwnedSnapshot: (
    userId: string,
    observedAt?: Date
  ) => Promise<MyTodaySnapshotRecord>
}

export class MyTodayRepositoryUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('My today repository is unavailable.', options)
    this.name = 'MyTodayRepositoryUnavailableError'
  }
}

export class MyTodayRepositoryIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MyTodayRepositoryIntegrityError'
  }
}

interface ClockRow {
  readonly observedAt: Date
  readonly today: string
}

interface StreakRow {
  readonly lastDay: string
  readonly length: bigint
}

interface AnsweredRow {
  readonly answeredCount: bigint
}

interface DueRow {
  readonly due: bigint
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024', 'P2034'])

const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

const toSafeCount = (value: bigint, field: string): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MyTodayRepositoryIntegrityError(
      `My today ${field} exceeds the safe integer range.`
    )
  }
  return Number(value)
}

const singleRow = <Row>(rows: readonly Row[], field: string): Row => {
  const row = rows[0]
  if (!row || rows.length !== 1) {
    throw new MyTodayRepositoryIntegrityError(
      `My today ${field} query returned an invalid cardinality.`
    )
  }
  return row
}

const koreaDay = (column: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`(${column} AT TIME ZONE 'Asia/Seoul')::date`

export const createMyTodayStreakQuery = (
  userId: string,
  observedAt: Date
): Prisma.Sql => Prisma.sql`
  WITH studied_day AS (
    SELECT DISTINCT ${koreaDay(Prisma.sql`session."submittedAt"`)} AS "day"
    FROM "StudySession" AS session
    WHERE session."userId" = ${userId}::uuid
      AND session."status" = 'SUBMITTED'::"StudySessionStatus"
      AND session."submittedAt" IS NOT NULL
      AND session."submittedAt" <= ${observedAt}
  ),
  studied_run AS (
    SELECT
      "day",
      "day" - (ROW_NUMBER() OVER (ORDER BY "day"))::integer AS "run"
    FROM studied_day
  )
  SELECT MAX("day")::text AS "lastDay", COUNT(*)::bigint AS "length"
  FROM studied_run
  GROUP BY "run"
  ORDER BY MAX("day") DESC
  LIMIT 1
`

export const createMyTodayAnsweredQuery = (
  userId: string,
  observedAt: Date,
  today: string
): Prisma.Sql => Prisma.sql`
  SELECT COALESCE(SUM(result."totalCount"), 0)::bigint AS "answeredCount"
  FROM "StudySession" AS session
  JOIN "StudyResult" AS result
    ON result."studySessionId" = session."id"
  WHERE session."userId" = ${userId}::uuid
    AND session."status" = 'SUBMITTED'::"StudySessionStatus"
    AND session."submittedAt" IS NOT NULL
    AND session."submittedAt" <= ${observedAt}
    AND ${koreaDay(Prisma.sql`session."submittedAt"`)} = ${today}::date
`

export const createPrismaMyTodayRepository = (
  client: PrismaClient
): MyTodayRepository => ({
  readOwnedSnapshot: async (userId, observedAt) => {
    try {
      return await client.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SET TRANSACTION READ ONLY`
          const clockSql = observedAt
            ? Prisma.sql`${observedAt}::timestamptz`
            : Prisma.sql`CURRENT_TIMESTAMP`
          const clock = singleRow(
            await transaction.$queryRaw<ClockRow[]>`
              SELECT
                ${clockSql} AS "observedAt",
                ${koreaDay(clockSql)}::text AS "today"
            `,
            'clock'
          )
          const streakRows = await transaction.$queryRaw<StreakRow[]>(
            createMyTodayStreakQuery(userId, clock.observedAt)
          )
          if (streakRows.length > 1) {
            throw new MyTodayRepositoryIntegrityError(
              'My today streak query returned an invalid cardinality.'
            )
          }
          const answered = singleRow(
            await transaction.$queryRaw<AnsweredRow[]>(
              createMyTodayAnsweredQuery(userId, clock.observedAt, clock.today)
            ),
            'answered'
          )
          const due = singleRow(
            await transaction.$queryRaw<DueRow[]>(
              createReviewQueueCountsQuery({
                ...listReviewQueueQuerySchema.parse({}),
                userId,
                observedAt: clock.observedAt
              })
            ),
            'review due'
          )
          const streak = streakRows[0]
          return {
            latestStreak: streak
              ? {
                  lastDay: streak.lastDay,
                  length: toSafeCount(streak.length, 'streak length')
                }
              : null,
            observedAt: clock.observedAt,
            reviewDueCount: toSafeCount(due.due, 'review due count'),
            today: clock.today,
            todayAnsweredCount: toSafeCount(
              answered.answeredCount,
              'answered count'
            )
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      )
    } catch (error: unknown) {
      if (isDatabaseUnavailableError(error)) {
        throw new MyTodayRepositoryUnavailableError({ cause: error })
      }
      throw error
    }
  }
})

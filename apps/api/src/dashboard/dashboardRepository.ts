import type {
  DashboardRepeatedWrongQuestion,
  DashboardSubjectStat
} from '@nihongo/contracts/dashboard/get-dashboard-stats'
import {
  Prisma,
  type PrismaClient,
  type StudyMode
} from '../generated/prisma/client.js'

export interface DashboardReadWindow {
  readonly activityFromInclusive: Date | null
  readonly activityToExclusive: Date | null
  readonly dailyFromInclusive: Date
  readonly dailyToExclusive: Date
  readonly userId: string
}

export interface DashboardSubjectAggregateRecord {
  readonly answeredCount: bigint
  readonly correctCount: bigint
  readonly subject: DashboardSubjectStat['subject']
}

export interface DashboardRecentSessionRecord {
  readonly correctCount: number
  readonly correctRateBasisPoints: number
  readonly durationSec: number
  readonly id: string
  readonly level: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
  readonly mode: StudyMode
  readonly subject: DashboardSubjectStat['subject']
  readonly submittedAt: Date
  readonly totalCount: number
}

export interface DashboardDailyAggregateRecord {
  readonly count: bigint
  readonly date: string
}

export interface DashboardWrongNoteCountsRecord {
  readonly solvedCount: bigint
  readonly totalCount: bigint
}

export interface DashboardRepeatedWrongRecord {
  readonly lastWrongAt: Date
  readonly level: DashboardRepeatedWrongQuestion['level']
  readonly questionId: string
  readonly questionText: string
  readonly status: DashboardRepeatedWrongQuestion['status']
  readonly subject: DashboardRepeatedWrongQuestion['subject']
  readonly wrongCount: number
}

export interface DashboardSnapshotRecord {
  readonly dailyCounts: readonly DashboardDailyAggregateRecord[]
  readonly noteCounts: DashboardWrongNoteCountsRecord
  readonly recentSessions: readonly DashboardRecentSessionRecord[]
  readonly repeatedWrongQuestions: readonly DashboardRepeatedWrongRecord[]
  readonly subjectStats: readonly DashboardSubjectAggregateRecord[]
}

export interface DashboardRepository {
  readOwnedSnapshot: (
    input: DashboardReadWindow
  ) => Promise<DashboardSnapshotRecord>
}

export class DashboardRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Dashboard repository is unavailable.', options)
    this.name = 'DashboardRepositoryUnavailableError'
  }
}

export class DashboardRepositoryIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DashboardRepositoryIntegrityError'
  }
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024', 'P2034'])

const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

const executeRepositoryOperation = async <Result>(
  operation: () => Promise<Result>
): Promise<Result> => {
  try {
    return await operation()
  } catch (error: unknown) {
    if (isDatabaseUnavailableError(error)) {
      throw new DashboardRepositoryUnavailableError({ cause: error })
    }
    throw error
  }
}

const toActivityRangeSql = (input: DashboardReadWindow): Prisma.Sql =>
  input.activityFromInclusive && input.activityToExclusive
    ? Prisma.sql`
        AND session."submittedAt" >= ${input.activityFromInclusive}
        AND session."submittedAt" < ${input.activityToExclusive}`
    : Prisma.sql``

export const createPrismaDashboardRepository = (
  client: PrismaClient
): DashboardRepository => ({
  readOwnedSnapshot: (input) =>
    executeRepositoryOperation(async () =>
      client.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SET TRANSACTION READ ONLY`
          const activityRange = toActivityRangeSql(input)
          const subjectStats = await transaction.$queryRaw<
            DashboardSubjectAggregateRecord[]
          >(Prisma.sql`
            SELECT
              session."subject",
              SUM(result."totalCount")::bigint AS "answeredCount",
              SUM(result."correctCount")::bigint AS "correctCount"
            FROM "StudySession" AS session
            JOIN "StudyResult" AS result
              ON result."studySessionId" = session."id"
            WHERE session."userId" = ${input.userId}::uuid
              AND session."status" = 'SUBMITTED'::"StudySessionStatus"
              AND session."submittedAt" IS NOT NULL
              ${activityRange}
            GROUP BY session."subject"
            ORDER BY CASE session."subject"
              WHEN 'VOCABULARY'::"QuestionSubject" THEN 1
              WHEN 'GRAMMAR'::"QuestionSubject" THEN 2
              WHEN 'READING'::"QuestionSubject" THEN 3
            END`)

          const recentSessions = await transaction.$queryRaw<
            DashboardRecentSessionRecord[]
          >(Prisma.sql`
            SELECT
              session."id",
              session."level",
              session."subject",
              session."mode",
              result."totalCount",
              result."correctCount",
              result."correctRateBasisPoints",
              result."durationSec",
              session."submittedAt"
            FROM "StudySession" AS session
            JOIN "StudyResult" AS result
              ON result."studySessionId" = session."id"
            WHERE session."userId" = ${input.userId}::uuid
              AND session."status" = 'SUBMITTED'::"StudySessionStatus"
              AND session."submittedAt" IS NOT NULL
              ${activityRange}
            ORDER BY session."submittedAt" DESC, session."id" ASC
            LIMIT 5`)

          const dailyCounts = await transaction.$queryRaw<
            DashboardDailyAggregateRecord[]
          >(Prisma.sql`
            SELECT
              TO_CHAR(
                session."submittedAt" AT TIME ZONE 'UTC',
                'YYYY-MM-DD'
              ) AS "date",
              SUM(result."totalCount")::bigint AS "count"
            FROM "StudySession" AS session
            JOIN "StudyResult" AS result
              ON result."studySessionId" = session."id"
            WHERE session."userId" = ${input.userId}::uuid
              AND session."status" = 'SUBMITTED'::"StudySessionStatus"
              AND session."submittedAt" IS NOT NULL
              ${activityRange}
              AND session."submittedAt" >= ${input.dailyFromInclusive}
              AND session."submittedAt" < ${input.dailyToExclusive}
            GROUP BY 1
            ORDER BY 1`)

          const noteCountRows = await transaction.$queryRaw<
            DashboardWrongNoteCountsRecord[]
          >(Prisma.sql`
            SELECT
              COUNT(*)::bigint AS "totalCount",
              COUNT(*) FILTER (
                WHERE note."status" = 'SOLVED'::"WrongNoteStatus"
              )::bigint AS "solvedCount"
            FROM "WrongNote" AS note
            WHERE note."userId" = ${input.userId}::uuid`)
          const noteCounts = noteCountRows[0]
          if (!noteCounts) {
            throw new DashboardRepositoryIntegrityError(
              'Dashboard WrongNote count query returned no row.'
            )
          }

          const repeatedWrongQuestions = await transaction.$queryRaw<
            DashboardRepeatedWrongRecord[]
          >(Prisma.sql`
            SELECT
              note."questionId",
              version."questionText",
              version."level",
              version."subject",
              note."wrongCount",
              note."status",
              note."lastWrongAt"
            FROM "WrongNote" AS note
            JOIN "QuestionVersion" AS version
              ON version."questionId" = note."questionId"
              AND version."id" = note."lastWrongQuestionVersionId"
            WHERE note."userId" = ${input.userId}::uuid
            ORDER BY
              note."wrongCount" DESC,
              note."lastWrongAt" DESC,
              note."id" ASC
            LIMIT 5`)

          return {
            subjectStats,
            recentSessions,
            dailyCounts,
            noteCounts,
            repeatedWrongQuestions
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      )
    )
})

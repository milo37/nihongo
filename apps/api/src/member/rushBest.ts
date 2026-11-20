import type {
  RushBestEntry,
  RushBestResponse,
  SubmitRushScoreBody,
  SubmitRushScoreResponse
} from '@nihongo/contracts/study/rush-best'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApplicationError } from '../errors/applicationError.js'

export interface RushBestRepository {
  /** Each returns null when no ACTIVE member owns the id. */
  read: (userId: string) => Promise<RushBestEntry[] | null>
  submit: (
    userId: string,
    body: SubmitRushScoreBody
  ) => Promise<SubmitRushScoreResponse | null>
}

export interface RushBestService {
  read: (userId: string) => Promise<RushBestResponse>
  submit: (
    userId: string,
    body: SubmitRushScoreBody
  ) => Promise<SubmitRushScoreResponse>
}

export class RushBestRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Rush best repository is unavailable.', options)
    this.name = 'RushBestRepositoryUnavailableError'
  }
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024', 'P2034'])

const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

interface RushBestRow {
  mode: RushBestEntry['mode']
  level: RushBestEntry['level']
  best: number
  achievedAt: Date
}

const ACTIVE_MEMBER = Prisma.sql`
  member."accountStatus" = 'ACTIVE' AND member."deletedAt" IS NULL`

const toEntry = (row: RushBestRow): RushBestEntry => ({
  mode: row.mode,
  level: row.level,
  best: row.best,
  achievedAt: row.achievedAt.toISOString()
})

const guard = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (error: unknown) {
    if (isDatabaseUnavailableError(error)) {
      throw new RushBestRepositoryUnavailableError({ cause: error })
    }
    throw error
  }
}

/**
 * #1043: nihongo_app may INSERT a "RushBest" row and UPDATE only "best" and
 * "achievedAt" (20261125090000_rush_best). One statement keeps the higher
 * score, so two rounds sent at once leave the larger one.
 */
export const createPrismaRushBestRepository = (
  client: PrismaClient
): RushBestRepository => ({
  read: (userId) =>
    guard(async () => {
      const rows = await client.$queryRaw<
        Array<{ [K in keyof RushBestRow]: RushBestRow[K] | null }>
      >(Prisma.sql`
        SELECT rush."mode", rush."level"::text AS "level",
          rush."best"::int AS "best", rush."achievedAt"
        FROM "User" AS member
        LEFT JOIN "RushBest" AS rush ON rush."userId" = member."id"
        WHERE member."id" = ${userId}::uuid AND ${ACTIVE_MEMBER}
        ORDER BY rush."mode", rush."level"
      `)
      if (rows.length === 0) return null
      return rows.flatMap((row) =>
        row.mode !== null &&
        row.level !== null &&
        row.best !== null &&
        row.achievedAt !== null
          ? [toEntry(row as RushBestRow)]
          : []
      )
    }),
  submit: (userId, { mode, level, score }) =>
    guard(async () => {
      const raised = await client.$queryRaw<RushBestRow[]>(Prisma.sql`
        INSERT INTO "RushBest" ("userId", "mode", "level", "best")
        SELECT member."id", ${mode}, ${level}::"JlptLevel", ${score}::smallint
        FROM "User" AS member
        WHERE member."id" = ${userId}::uuid AND ${ACTIVE_MEMBER}
        ON CONFLICT ("userId", "mode", "level") DO UPDATE
        SET "best" = EXCLUDED."best", "achievedAt" = clock_timestamp()
        WHERE "RushBest"."best" < EXCLUDED."best"
        RETURNING "mode", "level"::text AS "level", "best"::int AS "best",
          "achievedAt"
      `)
      if (raised[0]) return { best: toEntry(raised[0]), isNewBest: true }
      const kept = await client.$queryRaw<RushBestRow[]>(Prisma.sql`
        SELECT rush."mode", rush."level"::text AS "level",
          rush."best"::int AS "best", rush."achievedAt"
        FROM "RushBest" AS rush
        JOIN "User" AS member ON member."id" = rush."userId"
        WHERE rush."userId" = ${userId}::uuid AND ${ACTIVE_MEMBER}
          AND rush."mode" = ${mode} AND rush."level" = ${level}::"JlptLevel"
      `)
      return kept[0] ? { best: toEntry(kept[0]), isNewBest: false } : null
    })
})

export const createRushBestService = (
  repository: RushBestRepository
): RushBestService => {
  const run = async <T>(work: () => Promise<T | null>): Promise<T> => {
    let result: T | null
    try {
      result = await work()
    } catch (error: unknown) {
      if (error instanceof RushBestRepositoryUnavailableError) {
        throw new ApplicationError({
          code: 'SERVICE_UNAVAILABLE',
          message: '러시 최고 기록을 저장하거나 읽을 수 없습니다.',
          retryable: true,
          cause: error
        })
      }
      throw error
    }
    if (result === null) {
      throw new ApplicationError({
        code: 'AUTHENTICATION_REQUIRED',
        message: '러시 최고 기록은 로그인이 필요합니다.',
        retryable: false
      })
    }
    return result
  }
  return {
    read: async (userId) => ({
      bests: await run(() => repository.read(userId))
    }),
    submit: (userId, body) => run(() => repository.submit(userId, body))
  }
}

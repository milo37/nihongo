import type {
  StudyGoal,
  UpdateStudyGoalBody
} from '@nihongo/contracts/auth/study-goal'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApplicationError } from '../errors/applicationError.js'

type JlptLevel = UpdateStudyGoalBody['targetLevel']

export interface StudyGoalRepository {
  /** Each returns the goal, or null when no ACTIVE member owns the id. */
  read: (userId: string) => Promise<StudyGoal | null>
  update: (
    userId: string,
    targetLevel: JlptLevel,
    dailyGoal: number
  ) => Promise<StudyGoal | null>
  skipOnboarding: (userId: string) => Promise<StudyGoal | null>
}

export interface StudyGoalService {
  read: (userId: string) => Promise<StudyGoal>
  update: (userId: string, body: UpdateStudyGoalBody) => Promise<StudyGoal>
  skipOnboarding: (userId: string) => Promise<StudyGoal>
}

export class StudyGoalRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Study goal repository is unavailable.', options)
    this.name = 'StudyGoalRepositoryUnavailableError'
  }
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024', 'P2034'])

const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

interface StudyGoalRow {
  targetLevel: JlptLevel | null
  dailyGoal: number | null
  goalSetAt: Date | null
  skippedAt: Date | null
  todayAnsweredCount: number
}

const ACTIVE_MEMBER = Prisma.sql`
  member."accountStatus" = 'ACTIVE' AND member."deletedAt" IS NULL`

/**
 * One row for an ACTIVE member: the goal and the answers in sets submitted
 * since 00:00 Asia/Seoul today.
 */
const readGoal = async (
  client: Pick<PrismaClient, '$queryRaw'>,
  userId: string
): Promise<StudyGoal | null> => {
  const rows = await client.$queryRaw<StudyGoalRow[]>(Prisma.sql`
    SELECT member."targetLevel"::text AS "targetLevel",
      goal."dailyGoal"::int AS "dailyGoal",
      goal."goalSetAt",
      goal."onboardingSkippedAt" AS "skippedAt",
      (SELECT count(*)::int
       FROM "StudySession" AS session
       JOIN "StudySessionQuestion" AS question
         ON question."studySessionId" = session."id"
       JOIN "StudyAnswer" AS answer
         ON answer."studySessionQuestionId" = question."id"
       WHERE session."userId" = member."id"
         AND session."status" = 'SUBMITTED'
         AND session."submittedAt" >= (
           (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date::timestamp
             AT TIME ZONE 'Asia/Seoul'
         )) AS "todayAnsweredCount"
    FROM "User" AS member
    LEFT JOIN "UserStudyGoal" AS goal ON goal."userId" = member."id"
    WHERE member."id" = ${userId}::uuid AND ${ACTIVE_MEMBER}
  `)
  const row = rows[0]
  if (!row) return null
  return {
    targetLevel: row.targetLevel,
    dailyGoal: row.dailyGoal,
    goalSetAt: row.goalSetAt?.toISOString() ?? null,
    skippedAt: row.skippedAt?.toISOString() ?? null,
    onboardingRequired: row.goalSetAt === null && row.skippedAt === null,
    todayAnsweredCount: row.todayAnsweredCount
  }
}

const guard = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (error: unknown) {
    if (isDatabaseUnavailableError(error)) {
      throw new StudyGoalRepositoryUnavailableError({ cause: error })
    }
    throw error
  }
}

/**
 * #1090: nihongo_app may INSERT the "UserStudyGoal" columns and UPDATE only
 * "dailyGoal" and "goalSetAt" (20261121090000_user_study_goal), and UPDATE
 * only "targetLevel" on "User". A skip never replaces an answer.
 */
export const createPrismaStudyGoalRepository = (
  client: PrismaClient
): StudyGoalRepository => ({
  read: (userId) => guard(() => readGoal(client, userId)),
  update: (userId, targetLevel, dailyGoal) =>
    guard(() =>
      client.$transaction(async (transaction) => {
        const members = await transaction.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            UPDATE "User" AS member
            SET "targetLevel" = ${targetLevel}::"JlptLevel"
            WHERE member."id" = ${userId}::uuid AND ${ACTIVE_MEMBER}
            RETURNING member."id"
          `
        )
        if (members.length !== 1) return null
        await transaction.$executeRaw(Prisma.sql`
          INSERT INTO "UserStudyGoal" ("userId", "dailyGoal", "goalSetAt")
          VALUES (${userId}::uuid, ${dailyGoal}::smallint, clock_timestamp())
          ON CONFLICT ("userId") DO UPDATE
          SET "dailyGoal" = EXCLUDED."dailyGoal",
            "goalSetAt" = EXCLUDED."goalSetAt"
        `)
        return readGoal(transaction, userId)
      })
    ),
  skipOnboarding: (userId) =>
    guard(async () => {
      await client.$executeRaw(Prisma.sql`
        INSERT INTO "UserStudyGoal" ("userId", "onboardingSkippedAt")
        SELECT member."id", clock_timestamp()
        FROM "User" AS member
        WHERE member."id" = ${userId}::uuid AND ${ACTIVE_MEMBER}
        ON CONFLICT ("userId") DO NOTHING
      `)
      return readGoal(client, userId)
    })
})

export const createStudyGoalService = (
  repository: StudyGoalRepository
): StudyGoalService => {
  const run = async (
    work: () => Promise<StudyGoal | null>
  ): Promise<StudyGoal> => {
    let goal: StudyGoal | null
    try {
      goal = await work()
    } catch (error: unknown) {
      if (error instanceof StudyGoalRepositoryUnavailableError) {
        throw new ApplicationError({
          code: 'SERVICE_UNAVAILABLE',
          message: '학습 목표를 저장하거나 읽을 수 없습니다.',
          retryable: true,
          cause: error
        })
      }
      throw error
    }
    if (goal === null) {
      throw new ApplicationError({
        code: 'AUTHENTICATION_REQUIRED',
        message: '학습 목표는 로그인이 필요합니다.',
        retryable: false
      })
    }
    return goal
  }
  return {
    read: (userId) => run(() => repository.read(userId)),
    update: (userId, body) =>
      run(() => repository.update(userId, body.targetLevel, body.dailyGoal)),
    skipOnboarding: (userId) => run(() => repository.skipOnboarding(userId))
  }
}

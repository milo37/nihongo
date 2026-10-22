import { randomUUID } from 'node:crypto'
import { getDashboardInsightsResponseSchema } from '@nihongo/contracts/dashboard/get-dashboard-insights'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import {
  createDatabaseRuntime,
  createRoleDatabaseRuntime
} from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import {
  createPrismaStudySessionRepository,
  type ExistingStudyOwner
} from '../study/studySessionRepository.js'
import { createPrismaStudySubmissionRepository } from '../study/studySubmissionRepository.js'
import { createStudySubmissionService } from '../study/studySubmissionService.js'
import { createPrismaDashboardInsightsRepository } from './dashboardInsightsRepository.js'
import { createDashboardInsightsService } from './dashboardInsightsService.js'

const DAY_MILLISECONDS = 86_400_000

const environment = parseApiEnvironment(process.env)
const adminDatabaseUrl = process.env.PHASE7_ADMIN_DATABASE_URL
if (!adminDatabaseUrl) {
  throw new Error('Phase 8 integration requires the Phase 7 admin test URL.')
}
const authGatewayDatabaseUrl = environment.AUTH_GATEWAY_DATABASE_URL
if (!authGatewayDatabaseUrl) {
  throw new Error('Phase 8 integration requires the auth-gateway test URL.')
}
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createRoleDatabaseRuntime(
  environment.DATABASE_URL,
  'nihongo_app'
)
const adminDatabase = createDatabaseRuntime(adminDatabaseUrl)
const authGatewayDatabase = createRoleDatabaseRuntime(
  authGatewayDatabaseUrl,
  'nihongo_auth_gateway'
)
const sessionRepository = createPrismaStudySessionRepository(database.client)
const submissionRepository = createPrismaStudySubmissionRepository(
  database.client
)
const insightsService = createDashboardInsightsService(
  createPrismaDashboardInsightsRepository(database.client, 'PHASE7')
)

interface SubmittedFixture {
  readonly questionIds: readonly string[]
  readonly sessionId: string
}

const createUser = async (
  label: string
): Promise<{ sessionToken: string; userId: string }> => {
  const userId = randomUUID()
  const accountId = randomUUID()
  const now = new Date()
  await adminDatabase.client.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "User" (
        "id", "name", "email", "emailVerified", "role", "targetLevel",
        "accountStatus", "createdAt", "updatedAt"
      ) VALUES (
        ${userId}::uuid, ${`Phase 8 ${label}`},
        ${`phase8-${label}-${randomUUID()}@example.test`}, true, 'USER', 'N5',
        'ACTIVE', ${now}, ${now}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "Account" (
        "id", "accountId", "providerId", "userId", "password",
        "createdAt", "updatedAt"
      ) VALUES (
        ${accountId}, ${userId}, 'credential', ${userId}::uuid,
        'phase8-integration-password-hash', ${now}, ${now}
      )
    `
  })
  const sessionToken = `phase8-insights-${label}-${randomUUID()}`
  const sessionId = randomUUID()
  const issued = await authGatewayDatabase.client.$queryRawUnsafe<
    Array<{ familyId: string }>
  >(
    `SELECT * FROM "phase7_issue_v1_session"(
      $1, $2, $3::"UserRole", 'ACTIVE', $4, $5,
      '127.0.0.1', 'phase8-dashboard-insights', false
    )`,
    userId,
    1,
    'USER',
    sessionId,
    sessionToken
  )
  if (issued.length !== 1 || !issued[0]) {
    throw new Error('Phase 8 integration session was not issued.')
  }
  return { sessionToken, userId }
}

const submitRandomSession = async ({
  correctPattern,
  owner,
  requestedCount,
  submittedAt
}: {
  readonly correctPattern: readonly boolean[]
  readonly owner: Extract<ExistingStudyOwner, { kind: 'USER' }>
  readonly requestedCount: number
  readonly submittedAt: Date
}): Promise<SubmittedFixture> => {
  const startedAt = new Date(submittedAt.getTime() - 1_000)
  const created = await sessionRepository.createRandom({
    level: 'N5',
    subject: 'VOCABULARY',
    owner,
    requestedCount,
    startedAt,
    expiresAt: new Date(startedAt.getTime() + DAY_MILLISECONDS)
  })
  const materials = await database.client.studySessionQuestion.findMany({
    where: { studySessionId: created.session.id },
    orderBy: { ordinal: 'asc' },
    select: {
      id: true,
      questionId: true,
      questionVersion: { select: { correctOptionId: true } }
    }
  })
  if (materials.length === 0) {
    throw new Error('Phase 8 random fixture requires selected questions.')
  }
  await createStudySubmissionService(
    submissionRepository,
    () => submittedAt
  ).submit(
    created.session.id,
    randomUUID(),
    {
      answers: materials.map((material, index) => ({
        studySessionQuestionId: material.id,
        selectedOptionId:
          correctPattern[index] === true
            ? material.questionVersion.correctOptionId
            : null,
        elapsedSec: 10 + index
      })),
      durationSec: materials.reduce((total, _, index) => total + 10 + index, 0)
    },
    owner
  )
  return {
    sessionId: created.session.id,
    questionIds: materials.map(({ questionId }) => questionId)
  }
}

const submitWrongNoteSession = async (
  owner: Extract<ExistingStudyOwner, { kind: 'USER' }>,
  submittedAt: Date
): Promise<SubmittedFixture> => {
  const startedAt = new Date(submittedAt.getTime() - 1_000)
  const created = await sessionRepository.create({
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'WRONG_NOTE',
    owner,
    requestedCount: 1,
    practiceContractVersion: 2,
    startedAt,
    expiresAt: new Date(startedAt.getTime() + DAY_MILLISECONDS)
  })
  const material = await database.client.studySessionQuestion.findFirstOrThrow({
    where: { studySessionId: created.session.id },
    select: { id: true, questionId: true }
  })
  await createStudySubmissionService(
    submissionRepository,
    () => submittedAt
  ).submit(
    created.session.id,
    randomUUID(),
    {
      answers: [
        {
          studySessionQuestionId: material.id,
          selectedOptionId: null,
          elapsedSec: 0
        }
      ],
      durationSec: 0,
      expectedDraftRevision: 0
    },
    owner,
    2
  )
  return { sessionId: created.session.id, questionIds: [material.questionId] }
}

const readOwnedBusinessSnapshot = async (userId: string): Promise<unknown> =>
  await database.client.$queryRaw`
    SELECT jsonb_build_object(
      'sessions', (SELECT COUNT(*) FROM "StudySession" WHERE "userId" = ${userId}::uuid),
      'answers', (
        SELECT COUNT(*) FROM "StudyAnswer" AS answer
        JOIN "StudySessionQuestion" AS item
          ON item."id" = answer."studySessionQuestionId"
        JOIN "StudySession" AS session
          ON session."id" = item."studySessionId"
        WHERE session."userId" = ${userId}::uuid
      ),
      'wrongNotes', (SELECT COUNT(*) FROM "WrongNote" WHERE "userId" = ${userId}::uuid),
      'reviewSchedules', (
        SELECT COUNT(*) FROM "ReviewSchedule" AS schedule
        JOIN "WrongNote" AS note ON note."id" = schedule."wrongNoteId"
        WHERE note."userId" = ${userId}::uuid
      )
    ) AS snapshot
  `

beforeAll(async () => {
  await database.client.$queryRaw`SELECT 1`
  await adminDatabase.client.$queryRaw`SELECT 1`
  await authGatewayDatabase.client.$queryRaw`SELECT 1`
})

afterAll(async () => {
  await Promise.all([
    database.disconnect(),
    adminDatabase.disconnect(),
    authGatewayDatabase.disconnect()
  ])
})

describe.sequential('Phase 8 dashboard insights PostgreSQL projection', () => {
  let ownerUserId: string
  let ownerSessionToken: string
  let foreignUserId: string
  let foreignSessionToken: string
  let repeatedQuestionId: string

  beforeAll(async () => {
    const ownerFixture = await createUser('owner')
    ownerUserId = ownerFixture.userId
    ownerSessionToken = ownerFixture.sessionToken
    const foreignFixture = await createUser('foreign')
    foreignUserId = foreignFixture.userId
    foreignSessionToken = foreignFixture.sessionToken
    const now = Date.now()
    const owner = { kind: 'USER' as const, userId: ownerUserId }
    await submitRandomSession({
      owner,
      requestedCount: 5,
      correctPattern: [false, true, false, true, false],
      submittedAt: new Date(now - 2 * DAY_MILLISECONDS)
    })
    const repeated = await submitWrongNoteSession(
      owner,
      new Date(now - DAY_MILLISECONDS)
    )
    repeatedQuestionId = repeated.questionIds[0]!
    await submitRandomSession({
      owner: { kind: 'USER', userId: foreignUserId },
      requestedCount: 1,
      correctPattern: [false],
      submittedAt: new Date(now - DAY_MILLISECONDS)
    })
  })

  it('raw StudyAnswer와 fixed/tag aggregate를 재조정하고 owner 격리·write 0을 지킨다', async () => {
    const before = await readOwnedBusinessSnapshot(ownerUserId)
    const response = getDashboardInsightsResponseSchema.parse(
      await insightsService.getDashboardInsights({
        kind: 'PHASE7',
        sessionToken: ownerSessionToken,
        userId: ownerUserId
      })
    )
    const after = await readOwnedBusinessSnapshot(ownerUserId)
    const fromInclusive = new Date(response.window.fromInclusive)
    const toInclusive = new Date(response.window.toInclusive)
    const [overall] = await database.client.$queryRaw<
      Array<{
        attemptedCount: bigint
        correctCount: bigint
        elapsedTotal: bigint
        lastAnsweredAt: Date | null
      }>
    >`
      SELECT
        COUNT(*)::bigint AS "attemptedCount",
        COUNT(*) FILTER (WHERE answer."isCorrect")::bigint AS "correctCount",
        COALESCE(SUM(answer."elapsedSec"), 0)::bigint AS "elapsedTotal",
        MAX(answer."answeredAt") AS "lastAnsweredAt"
      FROM "StudySession" AS session
      JOIN "StudySessionQuestion" AS item
        ON item."studySessionId" = session."id"
      JOIN "StudyAnswer" AS answer
        ON answer."studySessionQuestionId" = item."id"
        AND answer."questionVersionId" = item."questionVersionId"
      WHERE session."userId" = ${ownerUserId}::uuid
        AND session."status" = 'SUBMITTED'::"StudySessionStatus"
        AND answer."answeredAt" >= ${fromInclusive}
        AND answer."answeredAt" <= ${toInclusive}
    `
    if (!overall) throw new Error('Raw aggregate row is required.')

    expect(after).toEqual(before)
    expect(response.stats.overall).toEqual({
      attemptedCount: Number(overall.attemptedCount),
      correctCount: Number(overall.correctCount),
      correctRateBasisPoints: Number(
        (overall.correctCount * 10_000n + overall.attemptedCount / 2n) /
          overall.attemptedCount
      ),
      averageElapsedSec: Number(
        (overall.elapsedTotal + overall.attemptedCount / 2n) /
          overall.attemptedCount
      ),
      lastAnsweredAt: overall.lastAnsweredAt?.toISOString() ?? null
    })
    expect(response.stats.overall.attemptedCount).toBe(6)
    expect(response.reviewQueueCounts.repeated).toBeGreaterThanOrEqual(1)

    const levelTotal = response.stats.byLevel.reduce(
      (total, stat) => total + stat.attemptedCount,
      0
    )
    const subjectTotal = response.stats.bySubject.reduce(
      (total, stat) => total + stat.attemptedCount,
      0
    )
    const typeTotal = response.stats.byQuestionType.reduce(
      (total, stat) => total + stat.attemptedCount,
      0
    )
    expect([levelTotal, subjectTotal, typeTotal]).toEqual([6, 6, 6])

    const rawTags = await database.client.$queryRaw<
      Array<{ attemptedCount: bigint; correctCount: bigint; tagId: string }>
    >`
      SELECT
        version_tag."tagId",
        COUNT(*)::bigint AS "attemptedCount",
        COUNT(*) FILTER (WHERE answer."isCorrect")::bigint AS "correctCount"
      FROM "StudySession" AS session
      JOIN "StudySessionQuestion" AS item
        ON item."studySessionId" = session."id"
      JOIN "StudyAnswer" AS answer
        ON answer."studySessionQuestionId" = item."id"
        AND answer."questionVersionId" = item."questionVersionId"
      JOIN "QuestionVersionTag" AS version_tag
        ON version_tag."questionVersionId" = item."questionVersionId"
      WHERE session."userId" = ${ownerUserId}::uuid
        AND session."status" = 'SUBMITTED'::"StudySessionStatus"
        AND answer."answeredAt" >= ${fromInclusive}
        AND answer."answeredAt" <= ${toInclusive}
      GROUP BY version_tag."tagId"
      ORDER BY version_tag."tagId"
    `
    expect(response.stats.byTagTotal).toBe(rawTags.length)
    expect(
      response.stats.byTag.map(({ attemptedCount, correctCount, tagId }) => ({
        tagId,
        attemptedCount: BigInt(attemptedCount),
        correctCount: BigInt(correctCount)
      }))
    ).toEqual(rawTags)

    const foreign = await insightsService.getDashboardInsights({
      kind: 'PHASE7',
      sessionToken: foreignSessionToken,
      userId: foreignUserId
    })
    expect(foreign.stats.overall.attemptedCount).toBe(1)
    expect(foreign.stats.overall.correctCount).toBe(0)
  })

  it('archived current question을 actionability에서 제외하되 pinned historical fact는 보존한다', async () => {
    const original = await adminDatabase.client.question.findUniqueOrThrow({
      where: { id: repeatedQuestionId },
      select: {
        lifecycleStatus: true,
        archivedAt: true,
        currentPublishedVersionId: true
      }
    })
    const before = await insightsService.getDashboardInsights({
      kind: 'PHASE7',
      sessionToken: ownerSessionToken,
      userId: ownerUserId
    })

    try {
      await adminDatabase.client.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(
          'SET LOCAL session_replication_role = replica'
        )
        await transaction.question.update({
          where: { id: repeatedQuestionId },
          data: {
            lifecycleStatus: 'ARCHIVED',
            archivedAt: new Date(),
            currentPublishedVersionId: null
          }
        })
      })
      const archived = await insightsService.getDashboardInsights({
        kind: 'PHASE7',
        sessionToken: ownerSessionToken,
        userId: ownerUserId
      })

      expect(archived.stats).toEqual(before.stats)
      expect(archived.reviewQueueCounts.repeated).toBeLessThan(
        before.reviewQueueCounts.repeated
      )
      expect(
        archived.recommendations.some(
          (recommendation) =>
            recommendation.kind === 'REPEATED_WRONG' &&
            recommendation.reason.questionId === repeatedQuestionId
        )
      ).toBe(false)
    } finally {
      await adminDatabase.client.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(
          'SET LOCAL session_replication_role = replica'
        )
        await transaction.question.update({
          where: { id: repeatedQuestionId },
          data: original
        })
      })
    }
  })
})

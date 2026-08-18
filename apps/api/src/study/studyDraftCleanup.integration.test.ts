import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { Prisma } from '../generated/prisma/client.js'
import { createPrismaStudyDraftCleanupRepository } from './studyDraftCleanupRepository.js'
import { createStudyDraftCleanupService } from './studyDraftCleanupService.js'
import { createPrismaStudyDraftRepository } from './studyDraftRepository.js'
import { createPrismaStudySessionRepository } from './studySessionRepository.js'
import { createPrismaStudySessionCleanupRepository } from './studySessionCleanupRepository.js'
import { createStudySessionCleanupService } from './studySessionCleanupService.js'
import { createPrismaStudySubmissionRepository } from './studySubmissionRepository.js'
import { createStudySubmissionService } from './studySubmissionService.js'

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS
const NOW = new Date(Date.now() - HOUR_MS)

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
const sessionRepository = createPrismaStudySessionRepository(database.client)
const draftRepository = createPrismaStudyDraftRepository(database.client)
const cleanupService = createStudyDraftCleanupService(
  createPrismaStudyDraftCleanupRepository(database.client),
  () => NOW
)
const createdUserIds = new Set<string>()
const createdGuestIds = new Set<string>()

const createUser = async (): Promise<string> => {
  const user = await database.client.user.create({
    data: {
      name: 'Slice 1 cleanup user',
      email: `slice1-cleanup-${randomUUID()}@example.test`,
      emailVerified: true
    },
    select: { id: true }
  })
  createdUserIds.add(user.id)
  return user.id
}

const createSession = async ({
  expiresAt,
  practiceContractVersion,
  startedAt,
  userId
}: {
  expiresAt: Date
  practiceContractVersion: 1 | 2
  startedAt: Date
  userId: string
}) =>
  (
    await sessionRepository.createRandom({
      owner: { kind: 'USER', userId },
      level: 'N5',
      subject: 'VOCABULARY',
      requestedCount: 1,
      startedAt,
      expiresAt,
      practiceContractVersion
    })
  ).session

const saveEmptyDraft = async (
  session: Awaited<ReturnType<typeof createSession>>,
  userId: string,
  observedAt: Date
) =>
  await draftRepository.saveAtomic({
    sessionId: session.id,
    idempotencyKey: randomUUID(),
    owner: { kind: 'USER', userId },
    observedAt,
    body: {
      expectedRevision: 0,
      currentOrdinal: 1,
      answers: session.questions.map(({ sessionQuestionId }) => ({
        studySessionQuestionId: sessionQuestionId,
        selectedOptionId: null,
        elapsedSec: 0
      }))
    }
  })

const createBulkOverdueSessions = async (
  userId: string,
  count: number
): Promise<string[]> => {
  const question = await database.client.question.findFirstOrThrow({
    where: {
      lifecycleStatus: 'ACTIVE',
      currentPublishedVersionId: { not: null },
      currentPublishedVersion: {
        is: {
          status: 'PUBLISHED',
          level: 'N5',
          subject: 'VOCABULARY'
        }
      }
    },
    select: { id: true, currentPublishedVersionId: true }
  })
  if (!question.currentPublishedVersionId) {
    throw new Error('Published question fixture가 필요합니다.')
  }

  return await database.client.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      CREATE TEMP TABLE "slice1_bulk_draft_cleanup" (
        "sessionId" UUID PRIMARY KEY,
        "sessionQuestionId" UUID NOT NULL,
        "startedAt" TIMESTAMPTZ(3) NOT NULL,
        "expiresAt" TIMESTAMPTZ(3) NOT NULL
      ) ON COMMIT DROP`
    await transaction.$executeRaw`
      INSERT INTO "slice1_bulk_draft_cleanup" (
        "sessionId", "sessionQuestionId", "startedAt", "expiresAt"
      )
      SELECT
        gen_random_uuid(),
        gen_random_uuid(),
        ${NOW}::timestamptz - INTERVAL '27 hours'
          - series.value * INTERVAL '1 millisecond',
        ${NOW}::timestamptz - INTERVAL '26 hours'
          - series.value * INTERVAL '1 millisecond'
      FROM generate_series(1, ${count}) AS series(value)`
    await transaction.$executeRaw`
      INSERT INTO "StudySession" (
        "id", "userId", "level", "subject", "mode", "status",
        "requestedCount", "actualCount", "usedFallback", "startedAt",
        "expiresAt", "practiceContractVersion", "createdAt", "updatedAt"
      )
      SELECT
        fixture."sessionId", ${userId}::uuid, 'N5', 'VOCABULARY', 'RANDOM',
        'IN_PROGRESS', 1, 1, false, fixture."startedAt",
        fixture."expiresAt", 2, fixture."startedAt", fixture."startedAt"
      FROM "slice1_bulk_draft_cleanup" AS fixture`
    await transaction.$executeRaw`
      INSERT INTO "StudySessionQuestion" (
        "id", "studySessionId", "questionId", "questionVersionId",
        "ordinal", "createdAt"
      )
      SELECT
        fixture."sessionQuestionId", fixture."sessionId", ${question.id}::uuid,
        ${question.currentPublishedVersionId}::uuid, 1, fixture."startedAt"
      FROM "slice1_bulk_draft_cleanup" AS fixture`
    await transaction.$executeRaw`
      INSERT INTO "StudyDraft" (
        "studySessionId", "revision", "currentOrdinal", "savedAt",
        "createdAt", "updatedAt"
      )
      SELECT
        fixture."sessionId", 0, 1, NULL,
        fixture."startedAt", fixture."startedAt"
      FROM "slice1_bulk_draft_cleanup" AS fixture`
    await transaction.$executeRaw`
      INSERT INTO "StudyDraftAnswer" (
        "studySessionId", "studySessionQuestionId", "questionVersionId",
        "selectedOptionId", "elapsedSec", "updatedAt"
      )
      SELECT
        fixture."sessionId", fixture."sessionQuestionId",
        ${question.currentPublishedVersionId}::uuid, NULL, 0,
        fixture."startedAt"
      FROM "slice1_bulk_draft_cleanup" AS fixture`

    const rows = await transaction.$queryRaw<{ id: string }[]>`
      SELECT "sessionId" AS "id"
      FROM "slice1_bulk_draft_cleanup"
      ORDER BY "expiresAt" ASC, "sessionId" ASC`
    return rows.map(({ id }) => id)
  })
}

const createBarrier = () => {
  let announceEntered: (() => void) | undefined
  let releaseWaiter: (() => void) | undefined
  const entered = new Promise<void>((resolve) => {
    announceEntered = resolve
  })
  const released = new Promise<void>((resolve) => {
    releaseWaiter = resolve
  })
  return {
    entered,
    release: () => releaseWaiter?.(),
    wait: async () => {
      announceEntered?.()
      await released
    }
  }
}

beforeAll(async () => {
  await database.checkReadiness()
})

afterAll(async () => {
  if (createdUserIds.size > 0) {
    await database.client.user.deleteMany({
      where: { id: { in: [...createdUserIds] } }
    })
  }
  if (createdGuestIds.size > 0) {
    await database.client.guestPrincipal.deleteMany({
      where: { id: { in: [...createdGuestIds] } }
    })
  }
  await database.disconnect()
})

describe('Phase 4 StudyDraft cold cleanup', () => {
  it('24h 경계, bounded batch, parent 보존, operation 격리와 metric을 보장한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const oldest = await createSession({
      userId,
      practiceContractVersion: 2,
      startedAt: new Date(NOW.getTime() - 27 * HOUR_MS),
      expiresAt: new Date(NOW.getTime() - 26 * HOUR_MS)
    })
    const atBoundary = await createSession({
      userId,
      practiceContractVersion: 2,
      startedAt: new Date(NOW.getTime() - 25 * HOUR_MS),
      expiresAt: new Date(NOW.getTime() - DAY_MS)
    })
    const beforeBoundary = await createSession({
      userId,
      practiceContractVersion: 2,
      startedAt: new Date(NOW.getTime() - 25 * HOUR_MS),
      expiresAt: new Date(NOW.getTime() - DAY_MS + 1)
    })

    const expiredDraftRecordSession = await createSession({
      userId,
      practiceContractVersion: 2,
      startedAt: new Date(NOW.getTime() - 72 * HOUR_MS),
      expiresAt: new Date(NOW.getTime() + DAY_MS)
    })
    const activeDraftRecordSession = await createSession({
      userId,
      practiceContractVersion: 2,
      startedAt: new Date(NOW.getTime() - 72 * HOUR_MS),
      expiresAt: new Date(NOW.getTime() + DAY_MS)
    })
    await saveEmptyDraft(
      expiredDraftRecordSession,
      userId,
      new Date(NOW.getTime() - 49 * HOUR_MS)
    )
    await saveEmptyDraft(
      activeDraftRecordSession,
      userId,
      new Date(NOW.getTime() - 47 * HOUR_MS)
    )

    const expiredSubmitSession = await createSession({
      userId,
      practiceContractVersion: 1,
      startedAt: new Date(NOW.getTime() - 48 * HOUR_MS),
      expiresAt: new Date(NOW.getTime() + DAY_MS)
    })
    await createStudySubmissionService(
      createPrismaStudySubmissionRepository(database.client),
      () => new Date(NOW.getTime() - 25 * HOUR_MS)
    ).submit(
      expiredSubmitSession.id,
      randomUUID(),
      {
        answers: expiredSubmitSession.questions.map(
          ({ sessionQuestionId }) => ({
            studySessionQuestionId: sessionQuestionId,
            selectedOptionId: null,
            elapsedSec: 0
          })
        ),
        durationSec: 0
      },
      owner
    )

    const first = await cleanupService.cleanup({ batchSize: 1 })
    expect(first).toMatchObject({
      overdueStudyDraftCount: 2,
      oldestOverdueExpiresAt: oldest.expiresAt.toISOString(),
      expiredStudyDraftCount: 1,
      expiredDraftBatchLimitReached: true,
      deletedDraftIdempotencyRecordCount: 1,
      expiredIdempotencyBatchLimitReached: true
    })
    expect(first.idempotencyOperationMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'STUDY_DRAFT_SAVE',
          activeRecordCount: 1,
          expiredRecordCount: 1,
          oldestActiveAgeSeconds: (47 * HOUR_MS) / 1_000,
          oldestExpiredAgeSeconds: (49 * HOUR_MS) / 1_000
        }),
        expect.objectContaining({
          operation: 'STUDY_RETRY_CREATE',
          activeRecordCount: 0,
          expiredRecordCount: 0
        }),
        expect.objectContaining({
          operation: 'STUDY_SUBMIT',
          expiredRecordCount: 1
        })
      ])
    )

    const second = await cleanupService.cleanup({ batchSize: 500 })
    expect(second).toMatchObject({
      overdueStudyDraftCount: 1,
      expiredStudyDraftCount: 1,
      expiredDraftBatchLimitReached: false,
      deletedDraftIdempotencyRecordCount: 0
    })

    const sessions = await database.client.studySession.findMany({
      where: {
        id: { in: [oldest.id, atBoundary.id, beforeBoundary.id] }
      },
      select: { id: true, status: true, draft: { select: { revision: true } } }
    })
    expect(sessions).toEqual(
      expect.arrayContaining([
        { id: oldest.id, status: 'EXPIRED', draft: null },
        { id: atBoundary.id, status: 'EXPIRED', draft: null },
        {
          id: beforeBoundary.id,
          status: 'IN_PROGRESS',
          draft: { revision: 0 }
        }
      ])
    )

    expect(
      await database.client.idempotencyRecord.count({
        where: {
          studySessionId: expiredDraftRecordSession.id,
          operation: 'STUDY_DRAFT_SAVE'
        }
      })
    ).toBe(0)
    expect(
      await database.client.idempotencyRecord.count({
        where: {
          studySessionId: activeDraftRecordSession.id,
          operation: 'STUDY_DRAFT_SAVE'
        }
      })
    ).toBe(1)
    expect(
      await database.client.idempotencyRecord.count({
        where: {
          studySessionId: expiredSubmitSession.id,
          operation: 'STUDY_SUBMIT'
        }
      })
    ).toBe(1)
  })

  it('실제 501개 후보를 500+1 batch로 제한한다', async () => {
    const userId = await createUser()
    const sessionIds = await createBulkOverdueSessions(userId, 501)

    const first = await cleanupService.cleanup({ batchSize: 500 })
    expect(first).toMatchObject({
      overdueStudyDraftCount: 501,
      expiredStudyDraftCount: 500,
      expiredDraftBatchLimitReached: true
    })
    expect(
      await database.client.studySession.count({
        where: { id: { in: sessionIds }, status: 'EXPIRED' }
      })
    ).toBe(500)

    const second = await cleanupService.cleanup({ batchSize: 500 })
    expect(second).toMatchObject({
      overdueStudyDraftCount: 1,
      expiredStudyDraftCount: 1,
      expiredDraftBatchLimitReached: false
    })
    expect(
      await database.client.studySession.count({
        where: { id: { in: sessionIds }, status: 'EXPIRED' }
      })
    ).toBe(501)
  }, 30_000)

  it('잠긴 후보를 기다리지 않고 SKIP LOCKED로 다음 session을 정리한다', async () => {
    const userId = await createUser()
    const lockedSession = await createSession({
      userId,
      practiceContractVersion: 2,
      startedAt: new Date(NOW.getTime() - 28 * HOUR_MS),
      expiresAt: new Date(NOW.getTime() - 27 * HOUR_MS)
    })
    const availableSession = await createSession({
      userId,
      practiceContractVersion: 2,
      startedAt: new Date(NOW.getTime() - 27 * HOUR_MS),
      expiresAt: new Date(NOW.getTime() - 26 * HOUR_MS)
    })
    const barrier = createBarrier()
    const lock = database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "StudySession"
          WHERE "id" = ${lockedSession.id}::uuid FOR UPDATE`
      )
      await barrier.wait()
    })
    await barrier.entered

    try {
      const result = await cleanupService.cleanup({ batchSize: 1 })
      expect(result.expiredStudyDraftCount).toBe(1)
      expect(
        await database.client.studySession.findMany({
          where: { id: { in: [lockedSession.id, availableSession.id] } },
          select: { id: true, status: true }
        })
      ).toEqual(
        expect.arrayContaining([
          { id: lockedSession.id, status: 'IN_PROGRESS' },
          { id: availableSession.id, status: 'EXPIRED' }
        ])
      )
    } finally {
      barrier.release()
      await lock
    }

    expect(
      (await cleanupService.cleanup({ batchSize: 1 })).expiredStudyDraftCount
    ).toBe(1)
  })

  it('guest draft replay TTL 동안 parent를 보존하고 만료 뒤 cleanup handoff한다', async () => {
    const preparedCredential = createGuestPrincipalService({
      client: database.client,
      secret: environment.GUEST_COOKIE_SECRET
    }).prepareCredential()
    const startedAt = new Date(NOW.getTime() - 48 * HOUR_MS)
    const credential = {
      ...preparedCredential,
      createdAt: startedAt,
      expiresAt: new Date(startedAt.getTime() + 7 * DAY_MS)
    }
    createdGuestIds.add(credential.id)
    const session = (
      await sessionRepository.createRandom({
        owner: { kind: 'NEW_GUEST', credential },
        level: 'N5',
        subject: 'VOCABULARY',
        requestedCount: 1,
        startedAt,
        expiresAt: new Date(NOW.getTime() - 25 * HOUR_MS),
        practiceContractVersion: 2
      })
    ).session
    const savedAt = new Date(NOW.getTime() - 47 * HOUR_MS - 30 * 60 * 1_000)
    await draftRepository.saveAtomic({
      sessionId: session.id,
      idempotencyKey: randomUUID(),
      owner: {
        kind: 'GUEST',
        guestPrincipalId: credential.id,
        tokenDigest: credential.tokenDigest
      },
      observedAt: savedAt,
      body: {
        expectedRevision: 0,
        currentOrdinal: 1,
        answers: session.questions.map(({ sessionQuestionId }) => ({
          studySessionQuestionId: sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        }))
      }
    })

    await cleanupService.cleanup({ batchSize: 10 })
    const guestCleanupNow = createStudySessionCleanupService(
      createPrismaStudySessionCleanupRepository(database.client),
      () => NOW
    )
    expect(
      (await guestCleanupNow.cleanup({ batchSize: 10 }))
        .deletedStudySessionCount
    ).toBe(0)
    expect(
      await database.client.studySession.count({ where: { id: session.id } })
    ).toBe(1)

    const afterReplayTtl = new Date(savedAt.getTime() + 48 * HOUR_MS)
    await createStudyDraftCleanupService(
      createPrismaStudyDraftCleanupRepository(database.client),
      () => afterReplayTtl
    ).cleanup({ batchSize: 10 })
    expect(
      (
        await createStudySessionCleanupService(
          createPrismaStudySessionCleanupRepository(database.client),
          () => afterReplayTtl
        ).cleanup({ batchSize: 10 })
      ).deletedStudySessionCount
    ).toBe(1)
    expect(
      await database.client.studySession.count({ where: { id: session.id } })
    ).toBe(0)
  })
})

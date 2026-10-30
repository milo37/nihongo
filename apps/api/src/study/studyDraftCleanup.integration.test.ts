import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { Prisma } from '../generated/prisma/client.js'
import { createPrismaStudyDraftCleanupRepository } from './studyDraftCleanupRepository.js'
import { createStudyDraftCleanupService } from './studyDraftCleanupService.js'
import { createPrismaStudyDraftRepository } from './studyDraftRepository.js'
import { createPrismaStudyResultRetryRepository } from './studyResultRetryRepository.js'
import { createStudyResultRetryService } from './studyResultRetryService.js'
import { createPrismaStudySessionRepository } from './studySessionRepository.js'
import { createPrismaStudySessionCleanupRepository } from './studySessionCleanupRepository.js'
import { createStudySessionCleanupService } from './studySessionCleanupService.js'
import { createPrismaStudySubmissionRepository } from './studySubmissionRepository.js'
import { createStudySubmissionService } from './studySubmissionService.js'
import { createPrismaWrongNoteTargetedReviewRepository } from '../wrong-note/wrongNoteTargetedReviewRepository.js'
import { createWrongNoteTargetedReviewService } from '../wrong-note/wrongNoteTargetedReviewService.js'

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS
const NOW = new Date(Date.now() - HOUR_MS)

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const isPhase10CurrentSource =
  process.env.PHASE10_CURRENT_SOURCE_INTEGRATION === '1'
const fixtureDatabaseUrl = process.env.PHASE10_FIXTURE_DATABASE_URL
const erasureWorkerDatabaseUrl = process.env.PHASE7_API_ERASURE_DATABASE_URL
if (
  isPhase10CurrentSource &&
  (!fixtureDatabaseUrl || !erasureWorkerDatabaseUrl)
) {
  throw new Error(
    'Phase 10 StudyDraft cleanup requires fixture and erasure databases.'
  )
}
for (const databaseUrl of [fixtureDatabaseUrl, erasureWorkerDatabaseUrl]) {
  if (databaseUrl) {
    assertSafeTestDatabase({
      nodeEnvironment: environment.NODE_ENV,
      databaseUrl,
      productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
    })
  }
}

const database = createDatabaseRuntime(
  environment.DATABASE_URL,
  isPhase10CurrentSource
    ? { migrationProfile: 'current', startupRole: 'nihongo_app' }
    : {}
)
const fixtureDatabase = fixtureDatabaseUrl
  ? createDatabaseRuntime(fixtureDatabaseUrl)
  : database
const erasureWorkerClient = erasureWorkerDatabaseUrl
  ? new Client({
      connectionString: erasureWorkerDatabaseUrl,
      options: createPostgresStartupOptions(
        getPostgresSchema(erasureWorkerDatabaseUrl)
      )
    })
  : undefined
const sessionRepository = createPrismaStudySessionRepository(database.client)
const draftRepository = createPrismaStudyDraftRepository(database.client)
const cleanupService = createStudyDraftCleanupService(
  createPrismaStudyDraftCleanupRepository(database.client),
  () => NOW
)
const createdUserIds = new Set<string>()
const createdGuestIds = new Set<string>()

const createUser = async (): Promise<string> => {
  const userId = randomUUID()
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        id: userId,
        name: 'Slice 1 cleanup user',
        email: `slice1-cleanup-${randomUUID()}@example.test`,
        emailVerified: true
      }
    })
    await fixture.account.create({
      data: {
        accountId: userId,
        password: 'phase10-fixture-password-hash',
        providerId: 'credential',
        userId
      }
    })
  })
  createdUserIds.add(userId)
  return userId
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

const createGuest = async (createdAt: Date) => {
  const prepared = createGuestPrincipalService({
    client: database.client,
    secret: environment.GUEST_COOKIE_SECRET
  }).prepareCredential()
  await database.client.guestPrincipal.create({
    data: {
      id: prepared.id,
      tokenDigest: prepared.tokenDigest,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + 7 * DAY_MS)
    }
  })
  createdGuestIds.add(prepared.id)
  return prepared
}

const createGuestSession = async ({
  expiresAt,
  startedAt
}: {
  expiresAt: Date
  startedAt: Date
}) => {
  const guest = await createGuest(startedAt)
  return (
    await sessionRepository.createRandom({
      owner: {
        kind: 'GUEST',
        guestPrincipalId: guest.id,
        tokenDigest: guest.tokenDigest
      },
      level: 'N5',
      subject: 'VOCABULARY',
      requestedCount: 1,
      startedAt,
      expiresAt,
      practiceContractVersion: 2
    })
  ).session
}

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

const createSubmittedIncorrectSession = async (
  userId: string,
  submittedAt: Date
) => {
  const session = await createSession({
    userId,
    practiceContractVersion: 2,
    startedAt: new Date(submittedAt.getTime() - HOUR_MS),
    expiresAt: new Date(submittedAt.getTime() + DAY_MS)
  })
  await createStudySubmissionService(
    createPrismaStudySubmissionRepository(database.client),
    () => submittedAt
  ).submit(
    session.id,
    randomUUID(),
    {
      answers: session.questions.map(({ sessionQuestionId }) => ({
        studySessionQuestionId: sessionQuestionId,
        selectedOptionId: null,
        elapsedSec: 0
      })),
      durationSec: 0,
      expectedDraftRevision: 0
    },
    { kind: 'USER', userId },
    2
  )
  return session
}

const createBulkOverdueSessions = async (
  guestPrincipalId: string,
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

  return await fixtureDatabase.client.$transaction(async (transaction) => {
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
        ${NOW}::timestamptz - INTERVAL '7 days 3 hours'
          - series.value * INTERVAL '1 millisecond',
        ${NOW}::timestamptz - INTERVAL '7 days 2 hours'
          - series.value * INTERVAL '1 millisecond'
      FROM generate_series(1, ${count}) AS series(value)`
    await transaction.$executeRaw`
      INSERT INTO "StudySession" (
        "id", "guestPrincipalId", "level", "subject", "mode", "status",
        "requestedCount", "actualCount", "usedFallback", "startedAt",
        "expiresAt", "practiceContractVersion", "createdAt", "updatedAt"
      )
      SELECT
        fixture."sessionId", ${guestPrincipalId}::uuid, 'N5', 'VOCABULARY', 'RANDOM',
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
  if (erasureWorkerClient) {
    await erasureWorkerClient.connect()
    await erasureWorkerClient.query(`SET ROLE "nihongo_erasure_worker"`)
  }
})

const cleanupOwnedFixtures = async () => {
  if (createdUserIds.size > 0) {
    if (erasureWorkerClient) {
      for (const userId of createdUserIds) {
        await erasureWorkerClient.query(
          `SELECT "phase7_erase_user"($1, 'TEST')`,
          [userId]
        )
      }
    } else {
      await fixtureDatabase.client.user.deleteMany({
        where: { id: { in: [...createdUserIds] } }
      })
    }
  }
  if (createdGuestIds.size > 0) {
    await database.client.guestPrincipal.deleteMany({
      where: { id: { in: [...createdGuestIds] } }
    })
  }
  createdUserIds.clear()
  createdGuestIds.clear()
}

afterEach(cleanupOwnedFixtures)

afterAll(async () => {
  await cleanupOwnedFixtures()
  if (erasureWorkerClient) {
    await erasureWorkerClient.end()
  }
  if (fixtureDatabase !== database) {
    await fixtureDatabase.disconnect()
  }
  await database.disconnect()
})

describe('Phase 4 StudyDraft cold cleanup', () => {
  it.each(['session', 'draft', 'submit'] as const)(
    '자연 만료 %s 경로는 즉시 거부하면서 guest draft와 replay를 보존한다',
    async (path) => {
      const startedAt = new Date(NOW.getTime() - 2 * DAY_MS)
      const expiresAt = new Date(NOW.getTime() - HOUR_MS)
      const guest = await createGuest(startedAt)
      const owner = {
        kind: 'GUEST' as const,
        guestPrincipalId: guest.id,
        tokenDigest: guest.tokenDigest
      }
      const session = (
        await sessionRepository.createRandom({
          owner,
          level: 'N5',
          subject: 'VOCABULARY',
          requestedCount: 1,
          startedAt,
          expiresAt,
          practiceContractVersion: 2
        })
      ).session
      const idempotencyKey = randomUUID()
      const body = {
        expectedRevision: 0,
        currentOrdinal: 1,
        answers: session.questions.map(({ sessionQuestionId }) => ({
          studySessionQuestionId: sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        }))
      }
      await draftRepository.saveAtomic({
        sessionId: session.id,
        idempotencyKey,
        owner,
        observedAt: new Date(expiresAt.getTime() - 1),
        body
      })

      if (path === 'session') {
        expect(
          await sessionRepository.findOwnedById(session.id, owner, NOW)
        ).toMatchObject({ status: 'EXPIRED' })
      } else if (path === 'draft') {
        await expect(
          draftRepository.findOwned(session.id, owner, NOW)
        ).rejects.toThrow()
      } else {
        const submission = createStudySubmissionService(
          createPrismaStudySubmissionRepository(database.client),
          () => NOW
        )
        await expect(
          submission.submit(
            session.id,
            randomUUID(),
            { answers: body.answers, durationSec: 0, expectedDraftRevision: 1 },
            owner,
            2
          )
        ).rejects.toThrow()
      }

      expect(
        await database.client.studySession.findUnique({
          where: { id: session.id },
          select: { status: true }
        })
      ).toEqual({ status: 'EXPIRED' })
      expect(
        await database.client.studyDraft.findUnique({
          where: { studySessionId: session.id }
        })
      ).not.toBeNull()
      await expect(
        database.client.studyDraft.delete({
          where: { studySessionId: session.id }
        })
      ).rejects.toThrow()
      expect(
        await draftRepository.saveAtomic({
          sessionId: session.id,
          idempotencyKey,
          owner,
          observedAt: NOW,
          body
        })
      ).toMatchObject({ replayed: true })
    }
  )

  it('명시적 게스트 삭제는 보존 중인 만료 draft도 함께 삭제한다', async () => {
    const service = createGuestPrincipalService({
      client: database.client,
      secret: 'guest-cleanup-test-secret-at-least-32-characters'
    })
    const expiresAt = new Date(NOW.getTime() - HOUR_MS)
    const createdAt = new Date(expiresAt.getTime() - 2 * HOUR_MS)
    const guest = service.prepareCredential()
    await fixtureDatabase.client.guestPrincipal.create({
      data: {
        id: guest.id,
        tokenDigest: guest.tokenDigest,
        createdAt,
        lastSeenAt: createdAt,
        expiresAt: new Date(NOW.getTime() + DAY_MS)
      }
    })
    createdGuestIds.add(guest.id)
    const session = (
      await sessionRepository.createRandom({
        owner: {
          kind: 'GUEST',
          guestPrincipalId: guest.id,
          tokenDigest: guest.tokenDigest
        },
        level: 'N5',
        subject: 'VOCABULARY',
        requestedCount: 1,
        startedAt: new Date(expiresAt.getTime() - HOUR_MS),
        expiresAt,
        practiceContractVersion: 2
      })
    ).session
    await sessionRepository.findOwnedById(
      session.id,
      {
        kind: 'GUEST',
        guestPrincipalId: guest.id,
        tokenDigest: guest.tokenDigest
      },
      NOW
    )
    expect(
      await database.client.studyDraft.findUnique({
        where: { studySessionId: session.id }
      })
    ).not.toBeNull()
    await service.clear(guest.cookieValue)
    expect(
      await database.client.guestPrincipal.findUnique({
        where: { id: guest.id }
      })
    ).toBeNull()
    expect(
      await database.client.studySession.findUnique({
        where: { id: session.id }
      })
    ).toBeNull()
  })

  it('자연 만료 guest draft를 7일 보존하고 변경은 거부한 뒤 정리한다', async () => {
    const expiresAt = new Date(NOW.getTime() - 7 * DAY_MS)
    const session = await createGuestSession({
      startedAt: new Date(expiresAt.getTime() - HOUR_MS),
      expiresAt
    })
    await database.client.studySession.update({
      where: { id: session.id },
      data: { status: 'EXPIRED', updatedAt: expiresAt }
    })
    expect(
      await database.client.studyDraft.findUnique({
        where: { studySessionId: session.id }
      })
    ).not.toBeNull()
    await expect(
      database.client.studyDraft.update({
        where: { studySessionId: session.id },
        data: { currentOrdinal: 1 }
      })
    ).rejects.toThrow()

    await cleanupService.cleanup({ batchSize: 100 })
    expect(
      await database.client.studyDraft.findUnique({
        where: { studySessionId: session.id }
      })
    ).toBeNull()
    expect(
      await database.client.studySession.findUnique({
        where: { id: session.id },
        select: { status: true }
      })
    ).toEqual({ status: 'EXPIRED' })
  })

  it('7일이 지난 회원 draft와 진행 중 상태를 보존한다', async () => {
    const userId = await createUser()
    const session = await createSession({
      userId,
      practiceContractVersion: 2,
      startedAt: new Date(NOW.getTime() - 9 * DAY_MS),
      expiresAt: new Date(NOW.getTime() - 8 * DAY_MS)
    })
    expect(
      await database.client.studyDraft.findUnique({
        where: { studySessionId: session.id }
      })
    ).not.toBeNull()

    await cleanupService.cleanup({ batchSize: 100 })

    expect(
      await database.client.studyDraft.findUnique({
        where: { studySessionId: session.id }
      })
    ).not.toBeNull()
    expect(
      await database.client.studySession.findUnique({
        where: { id: session.id },
        select: { userId: true, status: true }
      })
    ).toEqual({ userId, status: 'IN_PROGRESS' })
  })

  it('7일 경계, bounded batch, parent 보존, operation 격리와 metric을 보장한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const oldest = await createGuestSession({
      startedAt: new Date(NOW.getTime() - 7 * DAY_MS - 3 * HOUR_MS),
      expiresAt: new Date(NOW.getTime() - 7 * DAY_MS - 2 * HOUR_MS)
    })
    const atBoundary = await createGuestSession({
      startedAt: new Date(NOW.getTime() - 7 * DAY_MS - HOUR_MS),
      expiresAt: new Date(NOW.getTime() - 7 * DAY_MS)
    })
    const beforeBoundary = await createGuestSession({
      startedAt: new Date(NOW.getTime() - 7 * DAY_MS - HOUR_MS),
      expiresAt: new Date(NOW.getTime() - 7 * DAY_MS + 1)
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
      practiceContractVersion: 2,
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
        durationSec: 0,
        expectedDraftRevision: 0
      },
      owner,
      2
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

  it('draft 48시간과 retry 7일 경계를 operation별 독립 batch로 정리한다', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, userId }
    const cleanupAt = NOW
    const retryCreatedAt = new Date(cleanupAt.getTime() - 7 * DAY_MS)
    const source = await createSubmittedIncorrectSession(
      userId,
      new Date(retryCreatedAt.getTime() - HOUR_MS)
    )
    const retryRepository = createPrismaStudyResultRetryRepository(
      database.client
    )
    const expiredRetry = await createStudyResultRetryService(
      retryRepository,
      () => retryCreatedAt
    ).create(source.id, randomUUID(), owner)
    const activeRetry = await createStudyResultRetryService(
      retryRepository,
      () => new Date(retryCreatedAt.getTime() + 1)
    ).create(source.id, randomUUID(), owner)

    const expiredDraftSession = await createSession({
      userId,
      practiceContractVersion: 2,
      startedAt: new Date(cleanupAt.getTime() - 49 * HOUR_MS),
      expiresAt: new Date(cleanupAt.getTime() + DAY_MS)
    })
    const activeDraftSession = await createSession({
      userId,
      practiceContractVersion: 2,
      startedAt: new Date(cleanupAt.getTime() - 49 * HOUR_MS),
      expiresAt: new Date(cleanupAt.getTime() + DAY_MS)
    })
    await saveEmptyDraft(
      expiredDraftSession,
      userId,
      new Date(cleanupAt.getTime() - 48 * HOUR_MS)
    )
    await saveEmptyDraft(
      activeDraftSession,
      userId,
      new Date(cleanupAt.getTime() - 48 * HOUR_MS + 1)
    )

    const cleanup = createStudyDraftCleanupService(
      createPrismaStudyDraftCleanupRepository(database.client),
      () => cleanupAt
    )
    const first = await cleanup.cleanup({ batchSize: 1 })
    expect(first).toMatchObject({
      deletedDraftIdempotencyRecordCount: 1,
      deletedRetryIdempotencyRecordCount: 1,
      expiredDraftIdempotencyBatchLimitReached: true,
      expiredRetryIdempotencyBatchLimitReached: true,
      expiredIdempotencyBatchLimitReached: true
    })
    expect(first.idempotencyOperationMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'STUDY_DRAFT_SAVE',
          expiredRecordCount: 1
        }),
        expect.objectContaining({
          operation: 'STUDY_RETRY_CREATE',
          activeRecordCount: 1,
          expiredRecordCount: 1
        })
      ])
    )

    expect(
      await database.client.idempotencyRecord.count({
        where: {
          operation: 'STUDY_RETRY_CREATE',
          studySessionId: expiredRetry.response.session.id
        }
      })
    ).toBe(0)
    expect(
      await database.client.idempotencyRecord.count({
        where: {
          operation: 'STUDY_RETRY_CREATE',
          studySessionId: activeRetry.response.session.id
        }
      })
    ).toBe(1)
    expect(
      await database.client.idempotencyRecord.count({
        where: {
          operation: 'STUDY_SUBMIT',
          studySessionId: source.id
        }
      })
    ).toBe(1)

    await expect(cleanup.cleanup({ batchSize: 1 })).resolves.toMatchObject({
      deletedDraftIdempotencyRecordCount: 0,
      deletedRetryIdempotencyRecordCount: 0,
      expiredDraftIdempotencyBatchLimitReached: false,
      expiredRetryIdempotencyBatchLimitReached: false
    })
  })

  it('targeted review 7일 TTL을 별도 batch·metric으로 정리하고 target session은 보존한다', async () => {
    const userId = await createUser()
    const expiredCompletedAt = new Date(NOW.getTime() - 7 * DAY_MS)
    const activeCompletedAt = new Date(expiredCompletedAt.getTime() + 1)
    const source = await createSubmittedIncorrectSession(
      userId,
      new Date(expiredCompletedAt.getTime() - HOUR_MS)
    )
    const questionId = source.questions[0]?.question.id
    if (!questionId) {
      throw new Error('Targeted review question fixture가 필요합니다.')
    }
    const expiredTarget = await createWrongNoteTargetedReviewService(
      createPrismaWrongNoteTargetedReviewRepository(database.client),
      () => expiredCompletedAt
    ).createTargetedReviewSession(userId, questionId, randomUUID())
    const activeTarget = await createWrongNoteTargetedReviewService(
      createPrismaWrongNoteTargetedReviewRepository(database.client),
      () => activeCompletedAt
    ).createTargetedReviewSession(userId, questionId, randomUUID())

    const cleanup = createStudyDraftCleanupService(
      createPrismaStudyDraftCleanupRepository(database.client),
      () => NOW
    )
    const first = await cleanup.cleanup({ batchSize: 1 })
    expect(first).toMatchObject({
      deletedTargetedReviewIdempotencyRecordCount: 1,
      expiredTargetedReviewIdempotencyBatchLimitReached: true,
      expiredIdempotencyBatchLimitReached: true
    })
    expect(first.idempotencyOperationMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'STUDY_TARGETED_REVIEW_CREATE',
          activeRecordCount: 1,
          expiredRecordCount: 1
        })
      ])
    )
    expect(
      await database.client.idempotencyRecord.count({
        where: {
          operation: 'STUDY_TARGETED_REVIEW_CREATE',
          studySessionId: expiredTarget.response.session.id
        }
      })
    ).toBe(0)
    expect(
      await database.client.idempotencyRecord.count({
        where: {
          operation: 'STUDY_TARGETED_REVIEW_CREATE',
          studySessionId: activeTarget.response.session.id
        }
      })
    ).toBe(1)
    expect(
      await database.client.studySession.count({
        where: {
          id: {
            in: [
              expiredTarget.response.session.id,
              activeTarget.response.session.id
            ]
          }
        }
      })
    ).toBe(2)
    await expect(cleanup.cleanup({ batchSize: 1 })).resolves.toMatchObject({
      deletedTargetedReviewIdempotencyRecordCount: 0,
      expiredTargetedReviewIdempotencyBatchLimitReached: false
    })
  })

  it('실제 501개 후보를 500+1 batch로 제한한다', async () => {
    const guest = await createGuest(new Date(NOW.getTime() - 8 * DAY_MS))
    const sessionIds = await createBulkOverdueSessions(guest.id, 501)

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
    const lockedSession = await createGuestSession({
      startedAt: new Date(NOW.getTime() - 7 * DAY_MS - 4 * HOUR_MS),
      expiresAt: new Date(NOW.getTime() - 7 * DAY_MS - 3 * HOUR_MS)
    })
    const availableSession = await createGuestSession({
      startedAt: new Date(NOW.getTime() - 7 * DAY_MS - 3 * HOUR_MS),
      expiresAt: new Date(NOW.getTime() - 7 * DAY_MS - 2 * HOUR_MS)
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
    const replayNow = new Date(NOW.getTime() - 7 * DAY_MS)
    const startedAt = new Date(replayNow.getTime() - 48 * HOUR_MS)
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
        expiresAt: new Date(replayNow.getTime() - 25 * HOUR_MS),
        practiceContractVersion: 2
      })
    ).session
    const savedAt = new Date(
      replayNow.getTime() - 47 * HOUR_MS - 30 * 60 * 1_000
    )
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

    await createStudyDraftCleanupService(
      createPrismaStudyDraftCleanupRepository(database.client),
      () => replayNow
    ).cleanup({ batchSize: 10 })
    const guestCleanupNow = createStudySessionCleanupService(
      createPrismaStudySessionCleanupRepository(database.client),
      () => replayNow
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
      await database.client.studySession.count({ where: { id: session.id } })
    ).toBe(1)

    const retentionDeadline = new Date(session.expiresAt.getTime() + 7 * DAY_MS)
    await createStudyDraftCleanupService(
      createPrismaStudyDraftCleanupRepository(database.client),
      () => retentionDeadline
    ).cleanup({ batchSize: 10 })
    expect(
      (
        await createStudySessionCleanupService(
          createPrismaStudySessionCleanupRepository(database.client),
          () => retentionDeadline
        ).cleanup({ batchSize: 10 })
      ).deletedStudySessionCount
    ).toBe(1)
    expect(
      await database.client.studySession.count({ where: { id: session.id } })
    ).toBe(0)
  })
})

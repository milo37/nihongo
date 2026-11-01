import { createHash, randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from 'pg'
import { applyWrongNoteReview } from '@nihongo/domain/review/apply-wrong-note-review'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { createPrismaDashboardRepository } from '../dashboard/dashboardRepository.js'
import { createDashboardService } from '../dashboard/dashboardService.js'
import { createPrismaWrongNoteReviewQueueRepository } from '../wrong-note/wrongNoteReviewQueueRepository.js'
import { createWrongNoteReviewQueueService } from '../wrong-note/wrongNoteReviewQueueService.js'
import { createPrismaStudySessionCleanupRepository } from './studySessionCleanupRepository.js'
import { createStudySessionCleanupService } from './studySessionCleanupService.js'
import { createPrismaStudyResultRetryRepository } from './studyResultRetryRepository.js'
import { createStudyResultRetryService } from './studyResultRetryService.js'
import { createPrismaStudyV1RetirementRepository } from './studyV1RetirementRepository.js'
import { createStudyV1RetirementClient } from './studyV1RetirementClient.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createPrismaStudySubmissionRepository } from './studySubmissionRepository.js'
import { createPrismaStudyDraftRepository } from './studyDraftRepository.js'
import { createPrismaStudyDraftCleanupRepository } from './studyDraftCleanupRepository.js'
import { createStudyDraftCleanupService } from './studyDraftCleanupService.js'

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS
const NOW = new Date('2000-01-01T12:00:00.000Z')

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const isCurrentSourceIntegration =
  process.env.PHASE10_CURRENT_SOURCE_INTEGRATION === '1'
const fixtureDatabaseUrl = process.env.PHASE10_FIXTURE_DATABASE_URL
const erasureWorkerDatabaseUrl = process.env.PHASE7_API_ERASURE_DATABASE_URL
if (
  isCurrentSourceIntegration &&
  (!fixtureDatabaseUrl || !erasureWorkerDatabaseUrl)
) {
  throw new Error(
    'Phase 10 session cleanup requires fixture and erasure databases.'
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
  isCurrentSourceIntegration
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
const guestPrincipalService = createGuestPrincipalService({
  client: database.client,
  secret: environment.GUEST_COOKIE_SECRET
})
const service = createStudySessionCleanupService(
  createPrismaStudySessionCleanupRepository(database.client),
  () => NOW
)
const createdGuestPrincipalIds = new Set<string>()
const createdSessionIds = new Set<string>()
const createdUserIds = new Set<string>()

interface PinnedQuestion {
  id: string
  correctOptionId: string
  questionVersionId: string
}

type SessionOwner = { id: string; kind: 'GUEST' } | { id: string; kind: 'USER' }

type FixtureSessionStatus =
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'CANCELLED'
  | 'EXPIRED'

let retirementClient: PrismaClient
let pinnedQuestion: PinnedQuestion | undefined

const getPinnedQuestion = (): PinnedQuestion => {
  if (!pinnedQuestion) {
    throw new Error('StudySession cleanup question fixture가 필요합니다.')
  }
  return pinnedQuestion
}

const createGuestPrincipal = async (expiresAt: Date): Promise<string> => {
  const id = randomUUID()
  const createdAt = new Date(expiresAt.getTime() - 7 * DAY_MS)
  await database.client.guestPrincipal.create({
    data: {
      id,
      tokenDigest: createHash('sha256').update(id).digest('hex'),
      createdAt,
      lastSeenAt: createdAt,
      expiresAt
    }
  })
  createdGuestPrincipalIds.add(id)
  return id
}

const createUser = async (): Promise<string> => {
  const userId = randomUUID()
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        id: userId,
        name: 'Cleanup fixture user',
        email: `slice3-cleanup-${randomUUID()}@example.test`,
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
  owner,
  retryOfStudySessionId,
  onTransactionStarted,
  onTransactionStage,
  beforeCommit,
  practiceContractVersion,
  recordReview = false,
  status = 'IN_PROGRESS',
  submittedIsCorrect = true
}: {
  expiresAt: Date
  owner: SessionOwner
  retryOfStudySessionId?: string
  onTransactionStarted?: (pid: number) => void
  onTransactionStage?: (stage: 'insert-session' | 'children' | 'commit') => void
  beforeCommit?: () => Promise<void>
  practiceContractVersion?: 1 | 2
  recordReview?: boolean
  status?: FixtureSessionStatus
  submittedIsCorrect?: boolean
}): Promise<{ childId: string; sessionId: string }> => {
  const question = getPinnedQuestion()
  const contractVersion =
    practiceContractVersion ?? (retryOfStudySessionId ? 2 : 1)
  const startedAt = new Date(expiresAt.getTime() - DAY_MS)
  const childId = randomUUID()
  const sessionId = await database.client.$transaction(async (transaction) => {
    if (onTransactionStarted) {
      const rows = await transaction.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`
      if (!rows[0]) throw new Error('Missing retry backend PID.')
      onTransactionStarted(rows[0].pid)
    }
    onTransactionStage?.('insert-session')
    const session = await transaction.studySession.create({
      data: {
        ...(owner.kind === 'USER'
          ? { userId: owner.id }
          : { guestPrincipalId: owner.id }),
        ...(retryOfStudySessionId ? { retryOfStudySessionId } : {}),
        level: 'N5',
        subject: 'VOCABULARY',
        mode:
          retryOfStudySessionId && owner.kind === 'USER'
            ? 'WRONG_NOTE'
            : 'RANDOM',
        requestedCount: 1,
        actualCount: 1,
        usedFallback: false,
        practiceContractVersion: contractVersion,
        startedAt,
        expiresAt
      },
      select: { id: true }
    })
    onTransactionStage?.('children')
    await transaction.studySessionQuestion.create({
      data: {
        id: childId,
        studySessionId: session.id,
        questionId: question.id,
        questionVersionId: question.questionVersionId,
        ordinal: 1,
        createdAt: startedAt
      }
    })
    if (contractVersion === 2) {
      await transaction.studyDraft.create({
        data: {
          studySessionId: session.id,
          revision: 0,
          currentOrdinal: 1,
          savedAt: null,
          createdAt: startedAt,
          updatedAt: startedAt,
          answers: {
            create: {
              studySessionQuestionId: childId,
              questionVersionId: question.questionVersionId,
              selectedOptionId: null,
              elapsedSec: 0,
              updatedAt: startedAt
            }
          }
        }
      })
    }

    const terminalAt = new Date(startedAt.getTime() + HOUR_MS)
    if (status === 'SUBMITTED') {
      const idempotencyRecordId = randomUUID()
      const submissionHash = 'a'.repeat(64)
      const answerId = randomUUID()
      await transaction.studyAnswer.create({
        data: {
          id: answerId,
          studySessionQuestionId: childId,
          questionVersionId: question.questionVersionId,
          selectedOptionId: submittedIsCorrect
            ? question.correctOptionId
            : null,
          isCorrect: submittedIsCorrect,
          elapsedSec: 60,
          gradingVersion: 'server-grading-v1',
          answeredAt: terminalAt,
          gradedAt: terminalAt
        }
      })
      if (owner.kind === 'USER') {
        const existing = await transaction.wrongNote.findUnique({
          where: {
            userId_questionId: { userId: owner.id, questionId: question.id }
          }
        })
        if (recordReview || !submittedIsCorrect || existing) {
          const decision = applyWrongNoteReview({
            previous: existing,
            isCorrect: submittedIsCorrect,
            occurredAt: terminalAt
          })
          if (!decision) throw new Error('Expected a review fixture decision.')
          const wrongNoteId = existing?.id ?? randomUUID()
          if (existing) {
            await transaction.wrongNote.update({
              where: { id: wrongNoteId },
              data: {
                ...decision.wrongNote,
                lastWrongQuestionVersionId: submittedIsCorrect
                  ? existing.lastWrongQuestionVersionId
                  : question.questionVersionId,
                updatedAt: terminalAt,
                schedule: {
                  update: { ...decision.schedule, updatedAt: terminalAt }
                }
              }
            })
          } else {
            await transaction.wrongNote.create({
              data: {
                id: wrongNoteId,
                userId: owner.id,
                questionId: question.id,
                lastWrongQuestionVersionId: question.questionVersionId,
                ...decision.wrongNote,
                createdAt: terminalAt,
                updatedAt: terminalAt,
                schedule: {
                  create: {
                    id: randomUUID(),
                    ...decision.schedule,
                    updatedAt: terminalAt
                  }
                }
              }
            })
          }
          await transaction.reviewEvent.create({
            data: {
              id: randomUUID(),
              wrongNoteId,
              userId: owner.id,
              questionId: question.id,
              questionVersionId: question.questionVersionId,
              studySessionId: session.id,
              studyAnswerId: answerId,
              selectedOptionId: submittedIsCorrect
                ? question.correctOptionId
                : null,
              source: retryOfStudySessionId
                ? 'WRONG_NOTE_REVIEW'
                : 'STUDY_SUBMIT',
              ...decision.event
            }
          })
        }
      }
      await transaction.studyResult.create({
        data: {
          id: randomUUID(),
          studySessionId: session.id,
          totalCount: 1,
          correctCount: submittedIsCorrect ? 1 : 0,
          incorrectCount: submittedIsCorrect ? 0 : 1,
          correctRateBasisPoints: submittedIsCorrect ? 10_000 : 0,
          durationSec: 60,
          gradingVersion: 'server-grading-v1',
          createdAt: terminalAt
        }
      })
      await transaction.idempotencyRecord.create({
        data: {
          id: idempotencyRecordId,
          principalType: owner.kind,
          ...(owner.kind === 'USER'
            ? { userId: owner.id }
            : { guestPrincipalId: owner.id }),
          operation: 'STUDY_SUBMIT',
          contractVersion,
          idempotencyKey: randomUUID(),
          studySessionId: session.id,
          requestHash: submissionHash,
          state: 'PROCESSING',
          createdAt: terminalAt
        }
      })
      await transaction.studySession.update({
        where: { id: session.id },
        data: {
          status,
          submittedAt: terminalAt,
          durationSec: 60,
          submissionHash
        }
      })
      await transaction.idempotencyRecord.update({
        where: { id: idempotencyRecordId },
        data: {
          state: 'SUCCEEDED',
          responseStatus: 201,
          responseBody: { sessionId: session.id },
          completedAt: terminalAt,
          expiresAt: new Date(terminalAt.getTime() + DAY_MS)
        }
      })
    } else if (status === 'CANCELLED') {
      await transaction.studySession.update({
        where: { id: session.id },
        data: { status, cancelledAt: terminalAt }
      })
    } else if (status === 'EXPIRED') {
      await transaction.studySession.update({
        where: { id: session.id },
        data: { status }
      })
    }

    if (contractVersion === 2 && status !== 'IN_PROGRESS') {
      await transaction.studyDraft.delete({
        where: { studySessionId: session.id }
      })
    }
    onTransactionStage?.('commit')
    await beforeCommit?.()
    return session.id
  })
  createdSessionIds.add(sessionId)
  return { childId, sessionId }
}

beforeAll(async () => {
  retirementClient = createStudyV1RetirementClient({
    nodeEnvironment: environment.NODE_ENV,
    runtimeDatabaseUrl:
      process.env.PHASE7_RUNTIME_DATABASE_URL ?? environment.DATABASE_URL,
    migrationDatabaseUrl:
      process.env.PHASE7_MIGRATION_DATABASE_URL ??
      process.env.PRISMA_TEST_DATABASE_URL,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
  await database.checkReadiness()
  if (erasureWorkerClient) {
    await erasureWorkerClient.connect()
    await erasureWorkerClient.query(`SET ROLE "nihongo_erasure_worker"`)
  }
  const question = await database.client.question.findFirst({
    where: {
      lifecycleStatus: 'ACTIVE',
      currentPublishedVersionId: { not: null },
      currentPublishedVersion: {
        is: { level: 'N5', subject: 'VOCABULARY', status: 'PUBLISHED' }
      }
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      currentPublishedVersion: {
        select: { id: true, correctOptionId: true }
      }
    }
  })
  if (!question?.currentPublishedVersion?.correctOptionId) {
    throw new Error('StudySession cleanup question fixture가 부족합니다.')
  }
  pinnedQuestion = {
    id: question.id,
    correctOptionId: question.currentPublishedVersion.correctOptionId,
    questionVersionId: question.currentPublishedVersion.id
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
  if (createdSessionIds.size > 0) {
    await database.client.studySession.deleteMany({
      where: { id: { in: [...createdSessionIds] } }
    })
  }
  if (createdGuestPrincipalIds.size > 0) {
    await database.client.guestPrincipal.deleteMany({
      where: { id: { in: [...createdGuestPrincipalIds] } }
    })
  }
  createdUserIds.clear()
  createdSessionIds.clear()
  createdGuestPrincipalIds.clear()
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
  await retirementClient?.$disconnect()
  await database.disconnect()
})

describe('StudySession bounded retention cleanup', () => {
  it('빈 게스트 식별자는 만료 후 7일 정각부터 정리한다', async () => {
    const threshold = NOW.getTime() - 7 * DAY_MS
    const before = await createGuestPrincipal(new Date(threshold + 1))
    const exact = await createGuestPrincipal(new Date(threshold))
    const after = await createGuestPrincipal(new Date(threshold - 1))

    await service.cleanup({ batchSize: 100 })
    const remaining = await database.client.guestPrincipal.findMany({
      where: { id: { in: [before, exact, after] } },
      select: { id: true }
    })
    expect(remaining.map(({ id }) => id)).toEqual([before])
  })

  it('만료 후 7일 정각부터 게스트만 정리하고 회원과 직전 기록을 보존한다', async () => {
    const guestId = await createGuestPrincipal(new Date(NOW.getTime() + DAY_MS))
    const userId = await createUser()
    const threshold = NOW.getTime() - 7 * DAY_MS
    const before = await createSession({
      owner: { kind: 'GUEST', id: guestId },
      expiresAt: new Date(threshold + 1),
      status: 'EXPIRED'
    })
    const exact = await createSession({
      owner: { kind: 'GUEST', id: guestId },
      expiresAt: new Date(threshold),
      status: 'EXPIRED'
    })
    const after = await createSession({
      owner: { kind: 'GUEST', id: guestId },
      expiresAt: new Date(threshold - 1),
      status: 'EXPIRED'
    })
    const member = await createSession({
      owner: { kind: 'USER', id: userId },
      expiresAt: new Date(threshold - 1)
    })
    const active = await createSession({
      owner: { kind: 'GUEST', id: guestId },
      expiresAt: new Date(NOW.getTime() + HOUR_MS)
    })
    const pendingGuestId = await createGuestPrincipal(
      new Date(NOW.getTime() + DAY_MS)
    )
    const pending = await createSession({
      owner: { kind: 'GUEST', id: pendingGuestId },
      expiresAt: new Date(threshold - 1),
      status: 'EXPIRED'
    })
    const pendingConnection = new Client({
      connectionString: environment.DATABASE_URL,
      options: createPostgresStartupOptions(
        getPostgresSchema(environment.DATABASE_URL),
        'nihongo_app'
      )
    })
    const pendingRecordId = randomUUID()
    await pendingConnection.connect()
    try {
      await pendingConnection.query('BEGIN')
      await pendingConnection.query(
        'SELECT "id" FROM "GuestPrincipal" WHERE "id" = $1 FOR NO KEY UPDATE',
        [pendingGuestId]
      )
      await pendingConnection.query(
        `INSERT INTO "IdempotencyRecord"
          ("id", "principalType", "guestPrincipalId", "operation", "contractVersion", "idempotencyKey", "studySessionId", "requestHash", "state", "createdAt")
         VALUES ($1, 'GUEST', $2, 'STUDY_SUBMIT', 1, $3, $4, $5, 'PROCESSING', clock_timestamp())`,
        [
          pendingRecordId,
          pendingGuestId,
          randomUUID(),
          pending.sessionId,
          createHash('sha256').update(randomUUID()).digest('hex')
        ]
      )
      const processing = await pendingConnection.query<{
        state: string
        expiresAt: Date | null
      }>(
        'SELECT "state", "expiresAt" FROM "IdempotencyRecord" WHERE "id" = $1',
        [pendingRecordId]
      )
      expect(processing.rows).toEqual([
        { state: 'PROCESSING', expiresAt: null }
      ])
      await service.cleanup({ batchSize: 100 })
      const remaining = await database.client.studySession.findMany({
        where: {
          id: {
            in: [
              before.sessionId,
              exact.sessionId,
              after.sessionId,
              member.sessionId,
              active.sessionId,
              pending.sessionId
            ]
          }
        },
        select: { id: true }
      })
      expect(remaining.map(({ id }) => id).sort()).toEqual(
        [
          before.sessionId,
          member.sessionId,
          active.sessionId,
          pending.sessionId
        ].sort()
      )
    } finally {
      await pendingConnection.query('ROLLBACK')
      await pendingConnection.end()
    }
    await service.cleanup({ batchSize: 100 })
    expect(
      await database.client.studySession.findUnique({
        where: { id: pending.sessionId }
      })
    ).toBeNull()
  })

  it('기존 auth 만료 경로도 참조된 guest와 terminal session을 보존한다', async () => {
    const orphanGuestId = await createGuestPrincipal(
      new Date('1980-01-08T00:00:00.000Z')
    )
    const guestExpiresAt = new Date(Date.now() - HOUR_MS)
    const guestCreatedAt = new Date(guestExpiresAt.getTime() - 7 * DAY_MS)
    const preparedGuest = guestPrincipalService.prepareCredential()
    const referencedGuest = {
      id: preparedGuest.id,
      cookieValue: preparedGuest.cookieValue
    }
    await database.client.guestPrincipal.create({
      data: {
        id: preparedGuest.id,
        tokenDigest: preparedGuest.tokenDigest,
        createdAt: guestCreatedAt,
        lastSeenAt: guestCreatedAt,
        expiresAt: guestExpiresAt
      }
    })
    createdGuestPrincipalIds.add(referencedGuest.id)

    const referenced = await createSession({
      owner: { kind: 'GUEST', id: referencedGuest.id },
      expiresAt: new Date(NOW.getTime() - HOUR_MS),
      status: 'SUBMITTED'
    })

    await expect(guestPrincipalService.deleteExpired(1)).resolves.toBe(1)
    expect(
      await database.client.guestPrincipal.findUnique({
        where: { id: orphanGuestId }
      })
    ).toBeNull()
    expect(
      await database.client.guestPrincipal.findUnique({
        where: { id: referencedGuest.id }
      })
    ).not.toBeNull()

    await expect(
      guestPrincipalService.resolveExisting(referencedGuest.cookieValue)
    ).resolves.toBeNull()
    expect(
      await database.client.guestPrincipal.findUnique({
        where: { id: referencedGuest.id }
      })
    ).not.toBeNull()
    expect(
      await database.client.studySession.findUnique({
        where: { id: referenced.sessionId }
      })
    ).not.toBeNull()
  })

  it('guest session을 상태별 retention으로 삭제하고 USER·최근 결과는 보존한다', async () => {
    const [oldestGuestId, newerGuestId, futureGuestId, submittedGuestId] =
      await Promise.all([
        createGuestPrincipal(new Date(NOW.getTime() + DAY_MS)),
        createGuestPrincipal(new Date(NOW.getTime() + DAY_MS)),
        createGuestPrincipal(new Date(NOW.getTime() + DAY_MS)),
        createGuestPrincipal(new Date(NOW.getTime() + DAY_MS))
      ])
    const [cancelledGuestId, expiredStatusGuestId, userId] = await Promise.all([
      createGuestPrincipal(new Date(NOW.getTime() + DAY_MS)),
      createGuestPrincipal(new Date(NOW.getTime() + DAY_MS)),
      createUser()
    ])
    const oldSubmittedGuestId = randomUUID()
    const oldGuestCreatedAt = new Date(NOW.getTime() - 10 * DAY_MS)
    const oldGuestLastSeenAt = new Date(NOW.getTime() - 6 * DAY_MS)
    await database.client.guestPrincipal.create({
      data: {
        id: oldSubmittedGuestId,
        tokenDigest: createHash('sha256')
          .update(oldSubmittedGuestId)
          .digest('hex'),
        createdAt: oldGuestCreatedAt,
        lastSeenAt: oldGuestLastSeenAt,
        expiresAt: new Date(oldGuestLastSeenAt.getTime() + 7 * DAY_MS)
      }
    })
    createdGuestPrincipalIds.add(oldSubmittedGuestId)

    const oldest = await createSession({
      owner: { kind: 'GUEST', id: oldestGuestId },
      expiresAt: new Date(NOW.getTime() - 7 * DAY_MS - 2 * HOUR_MS),
      status: 'EXPIRED'
    })
    const newer = await createSession({
      owner: { kind: 'GUEST', id: newerGuestId },
      expiresAt: new Date(NOW.getTime() - 7 * DAY_MS - HOUR_MS),
      status: 'EXPIRED'
    })
    const future = await createSession({
      owner: { kind: 'GUEST', id: futureGuestId },
      expiresAt: new Date(NOW.getTime() + HOUR_MS)
    })
    const submitted = await createSession({
      owner: { kind: 'GUEST', id: submittedGuestId },
      expiresAt: new Date(NOW.getTime() - 3 * HOUR_MS),
      status: 'SUBMITTED'
    })
    await createSession({
      owner: { kind: 'GUEST', id: cancelledGuestId },
      expiresAt: new Date(NOW.getTime() - 7 * DAY_MS - 3 * HOUR_MS),
      status: 'CANCELLED'
    })
    await createSession({
      owner: { kind: 'GUEST', id: expiredStatusGuestId },
      expiresAt: new Date(NOW.getTime() - 7 * DAY_MS - 3 * HOUR_MS),
      status: 'EXPIRED'
    })
    const oldSubmitted = await createSession({
      owner: { kind: 'GUEST', id: oldSubmittedGuestId },
      expiresAt: new Date(NOW.getTime() - 8 * DAY_MS),
      status: 'SUBMITTED'
    })
    const userSession = await createSession({
      owner: { kind: 'USER', id: userId },
      expiresAt: new Date(NOW.getTime() - 8 * DAY_MS),
      status: 'SUBMITTED'
    })

    await expect(service.cleanup({ batchSize: 10 })).resolves.toMatchObject({
      deletedGuestPrincipalCount: 0,
      deletedStudySessionCount: 5,
      guestPrincipalBatchLimitReached: false,
      studySessionBatchLimitReached: false
    })
    expect(
      await database.client.studySession.count({
        where: {
          id: {
            in: [oldest.sessionId, newer.sessionId, oldSubmitted.sessionId]
          }
        }
      })
    ).toBe(0)
    for (const childId of [
      oldest.childId,
      newer.childId,
      oldSubmitted.childId
    ]) {
      expect(
        await database.client.studySessionQuestion.findUnique({
          where: { id: childId }
        })
      ).toBeNull()
    }

    const preservedIds = [
      future.sessionId,
      submitted.sessionId,
      userSession.sessionId
    ]
    expect(
      await database.client.idempotencyRecord.count({
        where: { studySessionId: submitted.sessionId }
      })
    ).toBe(0)
    expect(
      await database.client.studyAnswer.count({
        where: {
          studySessionQuestion: { studySessionId: submitted.sessionId }
        }
      })
    ).toBe(1)
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: submitted.sessionId }
      })
    ).toBe(1)
    expect(
      await database.client.idempotencyRecord.count({
        where: { studySessionId: userSession.sessionId }
      })
    ).toBe(0)
    expect(
      await database.client.studyAnswer.count({
        where: {
          studySessionQuestion: { studySessionId: userSession.sessionId }
        }
      })
    ).toBe(1)
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: userSession.sessionId }
      })
    ).toBe(1)
    expect(
      await database.client.studySession.count({
        where: { id: { in: preservedIds } }
      })
    ).toBe(preservedIds.length)
    expect(
      await database.client.guestPrincipal.count({
        where: {
          id: {
            in: [
              oldestGuestId,
              newerGuestId,
              futureGuestId,
              submittedGuestId,
              cancelledGuestId,
              expiredStatusGuestId,
              oldSubmittedGuestId
            ]
          }
        }
      })
    ).toBe(7)
  })

  it('guest retry replay 보존 뒤 target leaf부터 source와 owner를 순서대로 정리한다', async () => {
    const retryCreatedAt = new Date(NOW.getTime() - 7 * DAY_MS)
    const guestId = await createGuestPrincipal(
      new Date(NOW.getTime() - HOUR_MS)
    )
    const owner = {
      kind: 'GUEST' as const,
      guestPrincipalId: guestId,
      tokenDigest: createHash('sha256').update(guestId).digest('hex')
    }
    const source = await createSession({
      owner: { kind: 'GUEST', id: guestId },
      practiceContractVersion: 2,
      expiresAt: new Date(NOW.getTime() - 8 * DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false
    })
    const retry = await createStudyResultRetryService(
      createPrismaStudyResultRetryRepository(database.client),
      () => retryCreatedAt
    ).create(source.sessionId, randomUUID(), owner)
    const targetId = retry.response.session.id
    createdSessionIds.add(targetId)

    const beforeReplayExpiryCleanup = createStudySessionCleanupService(
      createPrismaStudySessionCleanupRepository(database.client),
      () => new Date(NOW.getTime() - 1)
    )
    await expect(
      beforeReplayExpiryCleanup.cleanup({ batchSize: 1 })
    ).resolves.toMatchObject({
      deletedStudySessionCount: 0,
      deletedGuestPrincipalCount: 0
    })
    expect(
      await database.client.studySession.count({
        where: { id: { in: [source.sessionId, targetId] } }
      })
    ).toBe(2)

    await expect(service.cleanup({ batchSize: 1 })).resolves.toMatchObject({
      deletedStudySessionCount: 0,
      deletedGuestPrincipalCount: 0
    })
    const retentionDeadline = new Date(NOW.getTime() + 7 * DAY_MS)
    await createStudyDraftCleanupService(
      createPrismaStudyDraftCleanupRepository(database.client),
      () => retentionDeadline
    ).cleanup({ batchSize: 10 })
    const expiredReplayCleanup = createStudySessionCleanupService(
      createPrismaStudySessionCleanupRepository(database.client),
      () => retentionDeadline
    )
    await expect(
      expiredReplayCleanup.cleanup({ batchSize: 1 })
    ).resolves.toMatchObject({
      deletedStudySessionCount: 1,
      deletedGuestPrincipalCount: 0,
      studySessionBatchLimitReached: true
    })
    expect(
      await database.client.studySession.findUnique({
        where: { id: targetId }
      })
    ).toBeNull()
    expect(
      await database.client.studySession.findUnique({
        where: { id: source.sessionId }
      })
    ).not.toBeNull()

    await expect(
      expiredReplayCleanup.cleanup({ batchSize: 1 })
    ).resolves.toMatchObject({
      deletedStudySessionCount: 1,
      deletedGuestPrincipalCount: 1
    })
    expect(
      await database.client.studySession.count({
        where: { id: { in: [source.sessionId, targetId] } }
      })
    ).toBe(0)
    expect(
      await database.client.guestPrincipal.findUnique({
        where: { id: guestId }
      })
    ).toBeNull()
  })

  it('참조 없는 만료 GuestPrincipal만 bounded·idempotent하게 삭제한다', async () => {
    const oldestOrphanId = await createGuestPrincipal(
      new Date(NOW.getTime() - 7 * DAY_MS - 3 * HOUR_MS)
    )
    const newerOrphanId = await createGuestPrincipal(
      new Date(NOW.getTime() - 7 * DAY_MS - 2 * HOUR_MS)
    )
    const futureOrphanId = await createGuestPrincipal(
      new Date(NOW.getTime() + HOUR_MS)
    )
    const referencedGuestId = await createGuestPrincipal(
      new Date(NOW.getTime() - HOUR_MS)
    )
    const referenced = await createSession({
      owner: { kind: 'GUEST', id: referencedGuestId },
      expiresAt: new Date(NOW.getTime() - 2 * HOUR_MS),
      status: 'SUBMITTED'
    })

    await expect(service.cleanup({ batchSize: 1 })).resolves.toMatchObject({
      deletedGuestPrincipalCount: 1,
      deletedStudySessionCount: 0,
      guestPrincipalBatchLimitReached: true
    })
    expect(
      await database.client.guestPrincipal.findUnique({
        where: { id: oldestOrphanId }
      })
    ).toBeNull()

    await expect(service.cleanup({ batchSize: 1 })).resolves.toMatchObject({
      deletedGuestPrincipalCount: 1,
      deletedStudySessionCount: 0,
      guestPrincipalBatchLimitReached: true
    })
    expect(
      await database.client.guestPrincipal.findUnique({
        where: { id: newerOrphanId }
      })
    ).toBeNull()
    await expect(service.cleanup({ batchSize: 1 })).resolves.toEqual({
      deletedGuestPrincipalCount: 0,
      deletedIdempotencyRecordCount: 0,
      deletedStudySessionCount: 0,
      guestPrincipalBatchLimitReached: false,
      idempotencyRecordBatchLimitReached: false,
      studySessionBatchLimitReached: false
    })

    expect(
      await database.client.guestPrincipal.findUnique({
        where: { id: futureOrphanId }
      })
    ).not.toBeNull()
    expect(
      await database.client.guestPrincipal.findUnique({
        where: { id: referencedGuestId }
      })
    ).not.toBeNull()
    expect(
      await database.client.studySession.findUnique({
        where: { id: referenced.sessionId }
      })
    ).not.toBeNull()
  })

  it('eligible session 삭제 뒤 같은 transaction에서 orphan expired guest를 정리한다', async () => {
    const guestId = await createGuestPrincipal(
      new Date(NOW.getTime() - 7 * DAY_MS - HOUR_MS)
    )
    const session = await createSession({
      owner: { kind: 'GUEST', id: guestId },
      expiresAt: new Date(NOW.getTime() - 7 * DAY_MS - 2 * HOUR_MS),
      status: 'EXPIRED'
    })

    await expect(service.cleanup({ batchSize: 10 })).resolves.toMatchObject({
      deletedGuestPrincipalCount: 1,
      deletedStudySessionCount: 1
    })
    expect(
      await database.client.studySession.findUnique({
        where: { id: session.sessionId }
      })
    ).toBeNull()
    expect(
      await database.client.studySessionQuestion.findUnique({
        where: { id: session.childId }
      })
    ).toBeNull()
    expect(
      await database.client.guestPrincipal.findUnique({
        where: { id: guestId }
      })
    ).toBeNull()
  })
})

describe('V1 retirement scoped fixture', () => {
  it('expires and deletes independent V1 while preserving V2 retry sources, owners and questions', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, id: userId }
    const active = await createSession({
      owner,
      expiresAt: new Date(NOW.getTime() + DAY_MS)
    })
    const independent = await createSession({
      owner,
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      status: 'SUBMITTED'
    })
    const source = await createSession({
      owner,
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false
    })
    const retry = await createSession({
      owner,
      expiresAt: new Date(NOW.getTime() + 2 * DAY_MS),
      retryOfStudySessionId: source.sessionId
    })
    const questionId = getPinnedQuestion().id
    const beforeRole = await retirementClient.$queryRaw<
      { currentRole: string }[]
    >`SELECT CURRENT_USER AS "currentRole"`
    expect(beforeRole).toEqual([{ currentRole: 'nihongo_phase7_migration' }])
    const existingOwner = { kind: 'USER' as const, userId }
    const submissions = createPrismaStudySubmissionRepository(database.client)
    expect(
      await submissions.findOwnedResult(source.sessionId, existingOwner, NOW)
    ).toEqual({ kind: 'NOT_FOUND' })
    const resumable = await createPrismaStudyDraftRepository(
      database.client
    ).listOwnedResumable(
      existingOwner,
      { page: 1, pageSize: 20, status: 'IN_PROGRESS' },
      NOW
    )
    expect(resumable.items.map((item) => item.id)).not.toContain(
      active.sessionId
    )
    expect(resumable.items.map((item) => item.id)).toContain(retry.sessionId)
    await expect(
      createPrismaStudyV1RetirementRepository(database.client).retire([
        active.sessionId
      ])
    ).rejects.toThrow(
      'V1 retirement requires the canonical TEST migration role.'
    )
    expect(
      await database.client.studySession.findUnique({
        where: { id: active.sessionId }
      })
    ).toMatchObject({ status: 'IN_PROGRESS' })
    const result = await createPrismaStudyV1RetirementRepository(
      retirementClient
    ).retire([
      active.sessionId,
      independent.sessionId,
      source.sessionId,
      retry.sessionId
    ])
    expect(result).toMatchObject({
      expiredCount: 1,
      deletedSessionCount: 2,
      preservedSessionCount: 1
    })
    const afterRole = await retirementClient.$queryRaw<
      { currentRole: string }[]
    >`SELECT CURRENT_USER AS "currentRole"`
    expect(afterRole).toEqual(beforeRole)
    expect(
      await database.client.studySession.findUnique({
        where: { id: independent.sessionId }
      })
    ).toBeNull()
    expect(
      await database.client.studySession.findUnique({
        where: { id: active.sessionId }
      })
    ).toBeNull()
    expect(
      await database.client.studyResult.findUnique({
        where: { studySessionId: source.sessionId }
      })
    ).not.toBeNull()
    expect(
      await database.client.studySession.findUnique({
        where: { id: retry.sessionId }
      })
    ).toMatchObject({
      practiceContractVersion: 2,
      retryOfStudySessionId: source.sessionId
    })
    expect(
      await database.client.idempotencyRecord.count({
        where: { studySessionId: independent.sessionId }
      })
    ).toBe(0)
    expect(
      await fixtureDatabase.client.user.findUnique({ where: { id: userId } })
    ).not.toBeNull()
    expect(
      await database.client.question.findUnique({ where: { id: questionId } })
    ).not.toBeNull()
  })
})

describe('V1 retirement mixed review fixture', () => {
  it('preserves a V1/V2 review chain, note, schedule and retry source unchanged', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, id: userId }
    const source = await createSession({
      owner,
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const retry = await createSession({
      owner,
      expiresAt: new Date(NOW.getTime() + 2 * DAY_MS),
      retryOfStudySessionId: source.sessionId,
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const beforeNote = await database.client.wrongNote.findUniqueOrThrow({
      where: {
        userId_questionId: { userId, questionId: getPinnedQuestion().id }
      },
      include: { schedule: true, events: { orderBy: { occurredAt: 'asc' } } }
    })
    expect(beforeNote.events).toHaveLength(2)
    const result = await createPrismaStudyV1RetirementRepository(
      retirementClient
    ).retire([source.sessionId, retry.sessionId])
    expect(result).toMatchObject({
      deletedSessionCount: 0,
      deletedWrongNoteCount: 0,
      preservedSessionCount: 1
    })
    const afterNote = await database.client.wrongNote.findUniqueOrThrow({
      where: { id: beforeNote.id },
      include: { schedule: true, events: { orderBy: { occurredAt: 'asc' } } }
    })
    expect(afterNote).toEqual(beforeNote)
    expect(
      await database.client.studySession.findUnique({
        where: { id: retry.sessionId }
      })
    ).toMatchObject({ retryOfStudySessionId: source.sessionId })
    expect(
      await database.client.studyResult.findUnique({
        where: { studySessionId: source.sessionId }
      })
    ).not.toBeNull()
  })
})

describe('V1 retirement aggregate fixture', () => {
  it('keeps mixed user aggregates while independent V1 counts disappear', async () => {
    const mixedUserId = await createUser()
    const independentUserId = await createUser()
    const mixedOwner = { kind: 'USER' as const, id: mixedUserId }
    const source = await createSession({
      owner: mixedOwner,
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const retry = await createSession({
      owner: mixedOwner,
      expiresAt: new Date(NOW.getTime() + 2 * DAY_MS),
      retryOfStudySessionId: source.sessionId,
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const independent = await createSession({
      owner: { kind: 'USER', id: independentUserId },
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const observedAt = new Date(NOW.getTime() + 3 * DAY_MS)
    const dashboard = createDashboardService(
      createPrismaDashboardRepository(database.client),
      () => observedAt
    )
    const review = createWrongNoteReviewQueueService(
      createPrismaWrongNoteReviewQueueRepository(database.client),
      () => observedAt
    )
    const readCounts = async (userId: string) => ({
      dashboard: await dashboard.getDashboardStats(userId, {
        from: '2000-01-01',
        to: '2000-01-04'
      }),
      review: await review.listReviewQueue(userId, {
        view: 'DUE',
        sort: 'NEXT_REVIEW',
        page: 1,
        pageSize: 20
      })
    })
    const mixedBefore = await readCounts(mixedUserId)
    const independentBefore = await readCounts(independentUserId)
    expect(mixedBefore.dashboard).toMatchObject({
      totalAnsweredCount: 2,
      correctCount: 0,
      wrongNoteCount: 1,
      solvedWrongNoteCount: 0,
      subjectStats: expect.arrayContaining([
        expect.objectContaining({
          subject: 'VOCABULARY',
          answeredCount: 2,
          correctCount: 0
        })
      ])
    })
    expect(
      mixedBefore.dashboard.dailyStudyCountLast7Days.map(({ count }) => count)
    ).toEqual([0, 0, 0, 1, 1, 0, 0])
    expect(mixedBefore.review).toMatchObject({
      total: 1,
      counts: { due: 1, unreviewed: 0, repeated: 1, solved: 0 },
      items: [
        { questionId: getPinnedQuestion().id, status: 'AGAIN', wrongCount: 2 }
      ]
    })
    expect(independentBefore.dashboard).toMatchObject({
      totalAnsweredCount: 1,
      correctCount: 0,
      wrongNoteCount: 1,
      solvedWrongNoteCount: 0
    })
    expect(independentBefore.review).toMatchObject({
      total: 1,
      counts: { due: 1, unreviewed: 1, repeated: 0, solved: 0 },
      items: [
        { questionId: getPinnedQuestion().id, status: 'NEW', wrongCount: 1 }
      ]
    })

    const retirement = createPrismaStudyV1RetirementRepository(retirementClient)
    expect(await retirement.retire([independent.sessionId])).toMatchObject({
      deletedSessionCount: 1,
      deletedWrongNoteCount: 1,
      preservedSessionCount: 0
    })
    const independentAfter = await readCounts(independentUserId)
    expect(independentAfter.dashboard).toMatchObject({
      totalAnsweredCount: 0,
      correctCount: 0,
      wrongNoteCount: 0,
      solvedWrongNoteCount: 0
    })
    expect(independentAfter.review).toMatchObject({
      total: 0,
      counts: { due: 0, unreviewed: 0, repeated: 0, solved: 0 },
      items: []
    })
    expect(await readCounts(mixedUserId)).toEqual(mixedBefore)

    expect(
      await retirement.retire([source.sessionId, retry.sessionId])
    ).toMatchObject({
      deletedSessionCount: 0,
      deletedWrongNoteCount: 0,
      preservedSessionCount: 1
    })
    expect(await readCounts(mixedUserId)).toEqual(mixedBefore)
    expect(await readCounts(independentUserId)).toEqual(independentAfter)
  })
})

describe('V1 retirement review isolation fixture', () => {
  it('removes an independent V1-only wrong note and keeps the account and question', async () => {
    const userId = await createUser()
    const legacy = await createSession({
      owner: { kind: 'USER', id: userId },
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const note = await database.client.wrongNote.findUniqueOrThrow({
      where: {
        userId_questionId: { userId, questionId: getPinnedQuestion().id }
      }
    })
    const result = await createPrismaStudyV1RetirementRepository(
      retirementClient
    ).retire([legacy.sessionId])
    expect(result).toMatchObject({
      deletedSessionCount: 1,
      deletedWrongNoteCount: 1
    })
    expect(
      await database.client.wrongNote.findUnique({ where: { id: note.id } })
    ).toBeNull()
    expect(
      await database.client.reviewEvent.count({
        where: { wrongNoteId: note.id }
      })
    ).toBe(0)
    expect(
      await fixtureDatabase.client.user.findUnique({ where: { id: userId } })
    ).not.toBeNull()
    expect(
      await database.client.question.findUnique({
        where: { id: getPinnedQuestion().id }
      })
    ).not.toBeNull()
  })

  it('preserves mixed V1/V2 review facts even without a retry edge', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, id: userId }
    const legacy = await createSession({
      owner,
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const current = await createSession({
      owner,
      practiceContractVersion: 2,
      expiresAt: new Date(NOW.getTime() + 2 * DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const before = await database.client.wrongNote.findUniqueOrThrow({
      where: {
        userId_questionId: { userId, questionId: getPinnedQuestion().id }
      },
      include: { schedule: true, events: { orderBy: { occurredAt: 'asc' } } }
    })
    expect(before.events).toHaveLength(2)
    const result = await createPrismaStudyV1RetirementRepository(
      retirementClient
    ).retire([legacy.sessionId, current.sessionId])
    expect(result).toMatchObject({
      deletedSessionCount: 0,
      preservedSessionCount: 1
    })
    const after = await database.client.wrongNote.findUniqueOrThrow({
      where: { id: before.id },
      include: { schedule: true, events: { orderBy: { occurredAt: 'asc' } } }
    })
    expect(after).toEqual(before)
    expect(
      await database.client.studyResult.findUnique({
        where: { studySessionId: current.sessionId }
      })
    ).not.toBeNull()
  })

  it('preserves a V1-only wrong note and session when a user memo is attached', async () => {
    const userId = await createUser()
    const legacy = await createSession({
      owner: { kind: 'USER', id: userId },
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const note = await database.client.wrongNote.findUniqueOrThrow({
      where: {
        userId_questionId: { userId, questionId: getPinnedQuestion().id }
      }
    })
    await database.client.userMemo.create({
      data: {
        wrongNoteId: note.id,
        text: 'fixture memo',
        createdAt: NOW,
        updatedAt: NOW
      }
    })
    const result = await createPrismaStudyV1RetirementRepository(
      retirementClient
    ).retire([legacy.sessionId])
    expect(result).toMatchObject({
      deletedSessionCount: 0,
      deletedWrongNoteCount: 0,
      preservedSessionCount: 1
    })
    expect(
      await database.client.userMemo.findUnique({
        where: { wrongNoteId: note.id }
      })
    ).toMatchObject({ text: 'fixture memo' })
  })
})

describe('V1 retirement trusted boundary', () => {
  const assertContextCleared = async () => {
    expect(
      await retirementClient.$queryRaw`SELECT CURRENT_USER AS "role"`
    ).toEqual([{ role: 'nihongo_phase7_migration' }])
    const active = await retirementClient.$transaction(async (transaction) => {
      await transaction.$executeRaw`SET LOCAL ROLE "nihongo_phase7_owner"`
      return await transaction.$queryRaw`SELECT "phase7_trusted_execution_active"('V1_RETIREMENT') AS active`
    })
    expect(active).toEqual([{ active: false }])
  }
  it('rejects direct app and owner deletes even with a forged setting', async () => {
    const userId = await createUser()
    const legacy = await createSession({
      owner: { kind: 'USER', id: userId },
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const note = await database.client.wrongNote.findUniqueOrThrow({
      where: {
        userId_questionId: { userId, questionId: getPinnedQuestion().id }
      }
    })
    await expect(
      database.client
        .$executeRaw`DELETE FROM "StudySession" WHERE "id" = ${legacy.sessionId}::uuid`
    ).rejects.toThrow('23514')
    await expect(
      database.client
        .$executeRaw`DELETE FROM "WrongNote" WHERE "id" = ${note.id}::uuid`
    ).rejects.toThrow('23514')
    for (const target of ['session', 'note'] as const) {
      await expect(
        retirementClient.$transaction(async (transaction) => {
          await transaction.$executeRaw`SET LOCAL ROLE "nihongo_phase7_owner"`
          await transaction.$queryRaw`SELECT pg_catalog.set_config('app.phase7_trusted_execution', 'V1_RETIREMENT', true)`
          if (target === 'session') {
            await transaction.$executeRaw`DELETE FROM "StudySession" WHERE "id" = ${legacy.sessionId}::uuid`
          } else {
            await transaction.$executeRaw`DELETE FROM "WrongNote" WHERE "id" = ${note.id}::uuid`
          }
        })
      ).rejects.toThrow('23514')
    }
    await expect(
      retirementClient.$transaction(async (transaction) => {
        await transaction.$executeRaw`SET LOCAL ROLE "nihongo_phase7_owner"`
        await transaction.$queryRaw`SELECT "phase7_open_trusted_execution"('V1_RETIREMENT', NULL, NULL)`
        await transaction.$executeRaw`DELETE FROM "StudySession" WHERE "id" = ${legacy.sessionId}::uuid`
      })
    ).rejects.toThrow('23514')
    expect(
      await database.client.studySession.findUnique({
        where: { id: legacy.sessionId }
      })
    ).not.toBeNull()
    expect(
      await database.client.wrongNote.findUnique({ where: { id: note.id } })
    ).not.toBeNull()
    await assertContextCleared()
  })

  it('denies out-of-scope deletes after a forged context and role switch', async () => {
    const userId = await createUser()
    const legacy = await createSession({
      owner: { kind: 'USER', id: userId },
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const note = await database.client.wrongNote.findUniqueOrThrow({
      where: {
        userId_questionId: { userId, questionId: getPinnedQuestion().id }
      }
    })
    for (const target of ['session', 'note'] as const) {
      await expect(
        retirementClient.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL ROLE "nihongo_phase7_owner"`
          await tx.$queryRaw`SELECT "phase7_open_trusted_execution"('V1_RETIREMENT', NULL, NULL)`
          await tx.$executeRaw`SET LOCAL ROLE "nihongo_phase7_migration"`
          if (target === 'session') {
            await tx.$executeRaw`DELETE FROM "StudySession" WHERE "id" = ${legacy.sessionId}::uuid`
          } else {
            await tx.$executeRaw`DELETE FROM "WrongNote" WHERE "id" = ${note.id}::uuid`
          }
        })
      ).rejects.toThrow('42501')
    }
    await expect(
      retirementClient.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE "nihongo_phase7_owner"`
        await tx.$queryRaw`SELECT "phase7_open_trusted_execution"('V1_RETIREMENT', NULL, NULL)`
        await tx.$executeRaw`SET LOCAL ROLE "nihongo_phase7_migration"`
        await tx.$queryRaw`SELECT * FROM "phase7_retire_v1_sessions"(ARRAY[${legacy.sessionId}::uuid])`
      })
    ).rejects.toThrow('23505')
    expect(
      await database.client.studySession.findUnique({
        where: { id: legacy.sessionId }
      })
    ).not.toBeNull()
    expect(
      await database.client.wrongNote.findUnique({ where: { id: note.id } })
    ).not.toBeNull()
    await assertContextCleared()
  })

  it('rejects V2 and shared V1 review targets atomically in the facade', async () => {
    const userId = await createUser()
    const owner = { kind: 'USER' as const, id: userId }
    const legacy = await createSession({
      owner,
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const current = await createSession({
      owner,
      practiceContractVersion: 2,
      expiresAt: new Date(NOW.getTime() + 2 * DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    await expect(
      database.client
        .$queryRaw`SELECT * FROM "phase7_retire_v1_sessions"(ARRAY[${legacy.sessionId}::uuid])`
    ).rejects.toThrow()
    await expect(
      retirementClient.$queryRaw`SELECT * FROM "phase7_retire_v1_sessions"(ARRAY[${legacy.sessionId}::uuid, ${legacy.sessionId}::uuid])`
    ).rejects.toThrow('42501')
    await expect(
      retirementClient.$queryRaw`SELECT * FROM "phase7_retire_v1_sessions"(ARRAY[${current.sessionId}::uuid])`
    ).rejects.toThrow('23514')
    await expect(
      retirementClient.$queryRaw`SELECT * FROM "phase7_retire_v1_sessions"(ARRAY[${legacy.sessionId}::uuid])`
    ).rejects.toThrow('23514')
    expect(
      await database.client.studySession.findUnique({
        where: { id: legacy.sessionId }
      })
    ).not.toBeNull()
    expect(
      await database.client.studySession.findUnique({
        where: { id: current.sessionId }
      })
    ).not.toBeNull()
    await assertContextCleared()
  })
  it('rolls back a successful facade deletion when its transaction fails', async () => {
    const userId = await createUser()
    const legacy = await createSession({
      owner: { kind: 'USER', id: userId },
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const note = await database.client.wrongNote.findUniqueOrThrow({
      where: {
        userId_questionId: { userId, questionId: getPinnedQuestion().id }
      }
    })
    await expect(
      retirementClient.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT * FROM "phase7_retire_v1_sessions"(ARRAY[${legacy.sessionId}::uuid])`
        throw new Error('fixture rollback')
      })
    ).rejects.toThrow('fixture rollback')
    expect(
      await database.client.studySession.findUnique({
        where: { id: legacy.sessionId }
      })
    ).not.toBeNull()
    expect(
      await database.client.wrongNote.findUnique({ where: { id: note.id } })
    ).not.toBeNull()
    await assertContextCleared()
  })
})

const isRetryConcurrencyConflict = (error: unknown): boolean => {
  const allowedRetryConstraints = new Set([
    'StudySession_retryOfStudySessionId_fkey',
    'StudySession_retryOfStudySessionId_userId_fkey',
    'StudySession_retryOfStudySessionId_guestPrincipalId_fkey'
  ])
  const pending: unknown[] = [error]
  const seen = new Set<object>()
  while (pending.length > 0 && seen.size < 12) {
    const value = pending.pop()
    if (typeof value !== 'object' || value === null || seen.has(value)) continue
    seen.add(value)
    const record = value as Record<string, unknown>
    if (
      record.name === 'PrismaClientKnownRequestError' &&
      record.code === 'P2034'
    )
      return true
    if (
      record.name === 'DriverAdapterError' &&
      typeof record.cause === 'object' &&
      record.cause !== null
    ) {
      const cause = record.cause as Record<string, unknown>
      if (
        cause.kind === 'ForeignKeyConstraintViolation' &&
        cause.originalCode === '23503' &&
        typeof cause.constraint === 'object' &&
        cause.constraint !== null &&
        typeof (cause.constraint as Record<string, unknown>).index ===
          'string' &&
        allowedRetryConstraints.has(
          (cause.constraint as { index: string }).index
        )
      )
        return true
      if (
        cause.kind === 'TransactionWriteConflict' &&
        cause.originalCode === '40001'
      )
        return true
      if (cause.kind === 'postgres' && cause.code === '40P01') return true
    }
    pending.push(record.cause, record.meta, record.driverAdapterError)
  }
  return false
}

const isReviewMemoConcurrencyConflict = (
  error: unknown,
  scenario: 'memo' | 'review',
  targetDeleted: boolean
): boolean => {
  const pending: unknown[] = [error]
  const seen = new Set<object>()
  while (pending.length > 0 && seen.size < 12) {
    const value = pending.pop()
    if (typeof value !== 'object' || value === null || seen.has(value)) continue
    seen.add(value)
    const record = value as Record<string, unknown>
    if (
      record.name === 'PrismaClientKnownRequestError' &&
      (record.code === 'P2034' ||
        (scenario === 'review' && targetDeleted && record.code === 'P2025'))
    )
      return true
    if (
      record.name === 'DriverAdapterError' &&
      typeof record.cause === 'object' &&
      record.cause !== null
    ) {
      const cause = record.cause as Record<string, unknown>
      if (
        cause.kind === 'TransactionWriteConflict' &&
        cause.originalCode === '40001'
      )
        return true
      if (cause.kind === 'postgres' && cause.code === '40P01') return true
      if (
        scenario === 'memo' &&
        targetDeleted &&
        cause.kind === 'ForeignKeyConstraintViolation' &&
        cause.originalCode === '23503' &&
        typeof cause.constraint === 'object' &&
        cause.constraint !== null &&
        (cause.constraint as Record<string, unknown>).index ===
          'UserMemo_wrongNoteId_fkey'
      )
        return true
    }
    pending.push(record.cause, record.meta, record.driverAdapterError)
  }
  return false
}

const isRetryLockRaceObserved = ({
  blockerPid,
  workerPid,
  retryPid,
  workerBlockedBy,
  retryBlockedBy,
  retryState
}: {
  blockerPid: number
  workerPid: number
  retryPid: number
  workerBlockedBy: number[]
  retryBlockedBy: number[]
  retryState: 'pending' | 'fulfilled' | 'rejected'
}): boolean => {
  if (new Set([blockerPid, workerPid, retryPid]).size !== 3) return false
  const workerWaitsForBlocker = workerBlockedBy.includes(blockerPid)
  const retryWaitsForBlocker = retryBlockedBy.includes(blockerPid)
  const retryWaitsForWorker = retryBlockedBy.includes(workerPid)
  return (
    (workerWaitsForBlocker &&
      (retryState === 'fulfilled' ||
        (retryState === 'pending' &&
          (retryWaitsForBlocker || retryWaitsForWorker)))) ||
    (retryState === 'pending' &&
      workerBlockedBy.includes(retryPid) &&
      retryWaitsForBlocker)
  )
}

describe('V1 retirement concurrency', () => {
  const makeClient = () =>
    createStudyV1RetirementClient({
      nodeEnvironment: environment.NODE_ENV,
      runtimeDatabaseUrl:
        process.env.PHASE7_RUNTIME_DATABASE_URL ?? environment.DATABASE_URL,
      migrationDatabaseUrl:
        process.env.PHASE7_MIGRATION_DATABASE_URL ??
        process.env.PRISMA_TEST_DATABASE_URL,
      productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
    })

  it('classifies only structured retry conflicts', () => {
    const adapter = (cause: unknown) =>
      Object.assign(new Error('adapter'), { name: 'DriverAdapterError', cause })
    const retryFk = {
      kind: 'ForeignKeyConstraintViolation',
      originalCode: '23503',
      constraint: { index: 'StudySession_retryOfStudySessionId_fkey' }
    }
    expect(isRetryConcurrencyConflict(adapter(retryFk))).toBe(true)
    expect(
      isRetryConcurrencyConflict({
        meta: { driverAdapterError: adapter(retryFk) }
      })
    ).toBe(true)
    expect(
      isRetryConcurrencyConflict(
        adapter({ kind: 'TransactionWriteConflict', originalCode: '40001' })
      )
    ).toBe(true)
    expect(
      isRetryConcurrencyConflict(adapter({ kind: 'postgres', code: '40P01' }))
    ).toBe(true)
    expect(
      isRetryConcurrencyConflict({
        name: 'PrismaClientKnownRequestError',
        code: 'P2034'
      })
    ).toBe(true)
    expect(
      isRetryConcurrencyConflict(
        adapter({ ...retryFk, constraint: { index: 'User_email_key' } })
      )
    ).toBe(false)
    expect(
      isRetryConcurrencyConflict(adapter({ kind: 'postgres', code: '23514' }))
    ).toBe(false)
    expect(
      isRetryConcurrencyConflict(
        new Error('ForeignKeyConstraintViolation 23503')
      )
    ).toBe(false)
    expect(
      isRetryConcurrencyConflict({
        kind: 'ForeignKeyConstraintViolation',
        originalCode: '23503'
      })
    ).toBe(false)
  })

  it('recognizes only verified retry lock chains', () => {
    const base = {
      blockerPid: 101,
      workerPid: 102,
      retryPid: 103,
      retryState: 'pending' as const
    }
    expect(
      isRetryLockRaceObserved({
        ...base,
        workerBlockedBy: [101],
        retryBlockedBy: [101]
      })
    ).toBe(true)
    expect(
      isRetryLockRaceObserved({
        ...base,
        workerBlockedBy: [101],
        retryBlockedBy: [102]
      })
    ).toBe(true)
    expect(
      isRetryLockRaceObserved({
        ...base,
        workerBlockedBy: [103],
        retryBlockedBy: [101]
      })
    ).toBe(true)
    expect(
      isRetryLockRaceObserved({
        ...base,
        retryState: 'fulfilled',
        workerBlockedBy: [101],
        retryBlockedBy: []
      })
    ).toBe(true)
    expect(
      isRetryLockRaceObserved({
        ...base,
        workerBlockedBy: [103],
        retryBlockedBy: [999]
      })
    ).toBe(false)
    expect(
      isRetryLockRaceObserved({
        ...base,
        workerBlockedBy: [999],
        retryBlockedBy: [101]
      })
    ).toBe(false)
    expect(
      isRetryLockRaceObserved({
        ...base,
        retryState: 'rejected',
        workerBlockedBy: [101],
        retryBlockedBy: [101]
      })
    ).toBe(false)
    expect(
      isRetryLockRaceObserved({
        ...base,
        retryPid: 101,
        workerBlockedBy: [101],
        retryBlockedBy: [101]
      })
    ).toBe(false)
  })

  it('classifies memo and review conflicts only at the correct boundary', () => {
    const adapter = (cause: unknown) =>
      Object.assign(new Error('adapter'), { name: 'DriverAdapterError', cause })
    const memoFk = adapter({
      kind: 'ForeignKeyConstraintViolation',
      originalCode: '23503',
      constraint: { index: 'UserMemo_wrongNoteId_fkey' }
    })
    const missing = { name: 'PrismaClientKnownRequestError', code: 'P2025' }
    const serialization = adapter({
      kind: 'TransactionWriteConflict',
      originalCode: '40001'
    })
    expect(isReviewMemoConcurrencyConflict(memoFk, 'memo', true)).toBe(true)
    expect(isReviewMemoConcurrencyConflict(memoFk, 'memo', false)).toBe(false)
    expect(isReviewMemoConcurrencyConflict(memoFk, 'review', true)).toBe(false)
    expect(isReviewMemoConcurrencyConflict(missing, 'review', true)).toBe(true)
    expect(isReviewMemoConcurrencyConflict(missing, 'review', false)).toBe(
      false
    )
    expect(isReviewMemoConcurrencyConflict(missing, 'memo', true)).toBe(false)
    expect(isReviewMemoConcurrencyConflict(serialization, 'memo', false)).toBe(
      true
    )
    expect(
      isReviewMemoConcurrencyConflict(
        new Error('UserMemo_wrongNoteId_fkey 23503'),
        'memo',
        true
      )
    ).toBe(false)
    expect(
      isReviewMemoConcurrencyConflict(
        adapter({ kind: 'postgres', code: '23514' }),
        'review',
        true
      )
    ).toBe(false)
  })

  it('rolls back an interrupted process and retries the same target', async () => {
    const userId = await createUser()
    const legacy = await createSession({
      owner: { kind: 'USER', id: userId },
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      status: 'SUBMITTED',
      submittedIsCorrect: false,
      recordReview: true
    })
    const note = await database.client.wrongNote.findUniqueOrThrow({
      where: {
        userId_questionId: { userId, questionId: getPinnedQuestion().id }
      }
    })
    const migrationUrl =
      process.env.PHASE7_MIGRATION_DATABASE_URL ??
      process.env.PRISMA_TEST_DATABASE_URL
    if (!migrationUrl) throw new Error('Missing guarded migration URL.')
    const program = `
      import pg from 'pg'
      const url = new URL(process.env.JLP544_RETIRE_DB)
      const schema = url.searchParams.get('schema')
      url.searchParams.delete('schema')
      url.searchParams.delete('options')
      const client = new pg.Client({ connectionString: url.toString(), options: '-c search_path=' + schema + ' -c role=nihongo_phase7_migration -c TimeZone=UTC' })
      try {
        await client.connect()
        await client.query('BEGIN')
        await client.query('SELECT * FROM "phase7_retire_v1_sessions"(ARRAY[$1::uuid])', [process.env.JLP544_RETIRE_ID])
        process.stdout.write('ready\\n')
        setInterval(() => {}, 1000)
      } catch { process.stderr.write('child failed\\n'); process.exitCode = 1; await client.end() }
    `
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', program],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JLP544_RETIRE_DB: migrationUrl,
          JLP544_RETIRE_ID: legacy.sessionId
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    const exited = new Promise<void>((resolve) =>
      child.once('exit', () => resolve())
    )
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                'Retirement child did not reach its transaction barrier.'
              )
            ),
          5_000
        )
        child.stdout.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('ready')) {
            clearTimeout(timer)
            resolve()
          }
        })
        child.once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.once('exit', () => {
          clearTimeout(timer)
          reject(new Error('Retirement child exited before the barrier.'))
        })
      })
      child.kill('SIGKILL')
      await exited
      expect(
        await database.client.studySession.findUnique({
          where: { id: legacy.sessionId }
        })
      ).not.toBeNull()
      expect(
        await database.client.wrongNote.findUnique({ where: { id: note.id } })
      ).not.toBeNull()
      const result = await createPrismaStudyV1RetirementRepository(
        retirementClient
      ).retire([legacy.sessionId])
      expect(result).toMatchObject({
        deletedSessionCount: 1,
        deletedWrongNoteCount: 1
      })
      expect(
        await database.client.studySession.findUnique({
          where: { id: legacy.sessionId }
        })
      ).toBeNull()
      expect(
        await fixtureDatabase.client.user.findUnique({ where: { id: userId } })
      ).not.toBeNull()
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill('SIGKILL')
      await exited
    }
  }, 15_000)

  const waitForBlock = async (waitingPid: number, blockingPid: number) => {
    const deadline = Date.now() + 1_000
    let blockers: number[] = []
    while (Date.now() < deadline) {
      const rows = await database.client.$queryRaw<{ blockers: number[] }[]>`
        SELECT pg_catalog.pg_blocking_pids(${waitingPid}::integer) AS blockers`
      blockers = rows[0]?.blockers ?? []
      if (blockers.includes(blockingPid)) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(
      `Expected ${waitingPid} to wait for ${blockingPid}; blockers=${blockers.join(',')}`
    )
  }

  it.each(['memo', 'review'] as const)(
    'commits %s before retirement and preserves the entire graph',
    async (scenario) => {
      const userId = await createUser()
      const owner = { kind: 'USER' as const, id: userId }
      const legacy = await createSession({
        owner,
        expiresAt: new Date(NOW.getTime() + DAY_MS),
        status: 'SUBMITTED',
        submittedIsCorrect: false,
        recordReview: true
      })
      const note = await database.client.wrongNote.findUniqueOrThrow({
        where: {
          userId_questionId: { userId, questionId: getPinnedQuestion().id }
        }
      })
      const worker = makeClient()
      let release = () => {}
      let markReady = (_pid: number) => {}
      let actorPid = 0
      const ready = new Promise<number>((resolve) => {
        markReady = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const actor =
        scenario === 'memo'
          ? database.client.$transaction(async (tx) => {
              const rows = await tx.$queryRaw<
                { pid: number }[]
              >`SELECT pg_backend_pid() AS pid`
              if (!rows[0]) throw new Error('Missing memo PID.')
              await tx.userMemo.create({
                data: {
                  wrongNoteId: note.id,
                  text: 'deterministic memo',
                  createdAt: new Date(NOW.getTime() + 2 * DAY_MS),
                  updatedAt: new Date(NOW.getTime() + 2 * DAY_MS)
                }
              })
              markReady(rows[0].pid)
              await gate
            })
          : createSession({
              owner,
              practiceContractVersion: 2,
              expiresAt: new Date(NOW.getTime() + 2 * DAY_MS),
              status: 'SUBMITTED',
              submittedIsCorrect: false,
              recordReview: true,
              onTransactionStarted: (pid) => {
                actorPid = pid
              },
              beforeCommit: async () => {
                markReady(actorPid)
                await gate
              }
            })
      const actorOutcome = actor.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      )
      try {
        const mutationPid = await Promise.race([
          ready,
          actorOutcome.then((result) => {
            throw new Error(`Mutation ended before barrier: ${result.ok}`)
          })
        ])
        expect(mutationPid).toBeGreaterThan(0)
        const rows = await worker.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`
        const workerPid = rows[0]?.pid
        if (!workerPid) throw new Error('Missing retirement PID.')
        const retirement = createPrismaStudyV1RetirementRepository(
          worker
        ).retire([legacy.sessionId])
        const retirementOutcome = retirement.then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
        await waitForBlock(workerPid, mutationPid)
        release()
        const mutationResult = await actorOutcome
        expect(mutationResult.ok).toBe(true)
        const retirementResult = await retirementOutcome
        if (retirementResult.ok) {
          expect(retirementResult.value).toMatchObject({
            deletedSessionCount: 0,
            preservedSessionCount: 1
          })
        } else {
          expect(
            isReviewMemoConcurrencyConflict(
              retirementResult.error,
              scenario,
              false
            )
          ).toBe(true)
        }
        expect(
          await database.client.studySession.findUnique({
            where: { id: legacy.sessionId }
          })
        ).not.toBeNull()
        expect(
          await database.client.studyResult.findUnique({
            where: { studySessionId: legacy.sessionId }
          })
        ).not.toBeNull()
        expect(
          await database.client.wrongNote.findUnique({ where: { id: note.id } })
        ).not.toBeNull()
        if (scenario === 'memo') {
          expect(
            await database.client.userMemo.findUnique({
              where: { wrongNoteId: note.id }
            })
          ).toMatchObject({ text: 'deterministic memo' })
        } else {
          expect(
            await database.client.reviewEvent.count({
              where: {
                wrongNoteId: note.id,
                studySession: { practiceContractVersion: 2 }
              }
            })
          ).toBe(1)
        }
        expect(
          await fixtureDatabase.client.user.findUnique({
            where: { id: userId }
          })
        ).not.toBeNull()
        expect(
          await fixtureDatabase.client.account.count({ where: { userId } })
        ).toBe(1)
        expect(
          await database.client.question.findUnique({
            where: { id: getPinnedQuestion().id }
          })
        ).not.toBeNull()
      } finally {
        release()
        await actorOutcome
        await worker.$disconnect()
      }
    },
    15_000
  )

  it.each(['memo', 'review'] as const)(
    'rejects %s atomically when retirement commits first',
    async (scenario) => {
      const userId = await createUser()
      const owner = { kind: 'USER' as const, id: userId }
      const legacy = await createSession({
        owner,
        expiresAt: new Date(NOW.getTime() + DAY_MS),
        status: 'SUBMITTED',
        submittedIsCorrect: false,
        recordReview: true
      })
      const note = await database.client.wrongNote.findUniqueOrThrow({
        where: {
          userId_questionId: { userId, questionId: getPinnedQuestion().id }
        }
      })
      let release = () => {}
      let markReady = (_pid: number) => {}
      const ready = new Promise<number>((resolve) => {
        markReady = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const holderRows = await retirementClient.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`
      const holderPid = holderRows[0]?.pid
      if (!holderPid) throw new Error('Missing retirement PID.')
      const retirement = retirementClient.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT * FROM "phase7_retire_v1_sessions"(ARRAY[${legacy.sessionId}::uuid])`
        markReady(holderPid)
        await gate
      })
      const retirementOutcome = retirement.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      )
      let actorReady = (_pid: number) => {}
      const started = new Promise<number>((resolve) => {
        actorReady = resolve
      })
      try {
        await Promise.race([
          ready,
          retirementOutcome.then((result) => {
            throw new Error(`Retirement ended before barrier: ${result.ok}`)
          })
        ])
        const mutation =
          scenario === 'memo'
            ? database.client.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<
                  { pid: number }[]
                >`SELECT pg_backend_pid() AS pid`
                if (!rows[0]) throw new Error('Missing memo PID.')
                actorReady(rows[0].pid)
                await tx.userMemo.create({
                  data: {
                    wrongNoteId: note.id,
                    text: 'must roll back',
                    createdAt: new Date(NOW.getTime() + 2 * DAY_MS),
                    updatedAt: new Date(NOW.getTime() + 2 * DAY_MS)
                  }
                })
              })
            : createSession({
                owner,
                practiceContractVersion: 2,
                expiresAt: new Date(NOW.getTime() + 2 * DAY_MS),
                status: 'SUBMITTED',
                submittedIsCorrect: false,
                recordReview: true,
                onTransactionStarted: actorReady
              })
        const mutationOutcome = mutation.then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error })
        )
        const mutationPid = await Promise.race([
          started,
          mutationOutcome.then((result) => {
            throw new Error(`Mutation ended before lock: ${result.ok}`)
          })
        ])
        await waitForBlock(mutationPid, holderPid)
        release()
        expect((await retirementOutcome).ok).toBe(true)
        const result = await mutationOutcome
        expect(result.ok).toBe(false)
        if (result.ok) throw new Error('Mutation unexpectedly committed.')
        expect(
          isReviewMemoConcurrencyConflict(result.error, scenario, true)
        ).toBe(true)
        expect(
          await database.client.studySession.findUnique({
            where: { id: legacy.sessionId }
          })
        ).toBeNull()
        expect(
          await database.client.studyResult.findUnique({
            where: { studySessionId: legacy.sessionId }
          })
        ).toBeNull()
        expect(
          await database.client.wrongNote.findUnique({ where: { id: note.id } })
        ).toBeNull()
        expect(
          await database.client.userMemo.findUnique({
            where: { wrongNoteId: note.id }
          })
        ).toBeNull()
        expect(
          await database.client.reviewEvent.count({ where: { userId } })
        ).toBe(0)
        expect(
          await database.client.studySession.count({
            where: { userId, practiceContractVersion: 2 }
          })
        ).toBe(0)
        expect(
          await fixtureDatabase.client.user.findUnique({
            where: { id: userId }
          })
        ).not.toBeNull()
        expect(
          await fixtureDatabase.client.account.count({ where: { userId } })
        ).toBe(1)
        expect(
          await database.client.question.findUnique({
            where: { id: getPinnedQuestion().id }
          })
        ).not.toBeNull()
      } finally {
        release()
        await retirementOutcome
      }
    },
    15_000
  )

  it.each(['retry', 'memo', 'review'] as const)(
    'preserves a successful concurrent %s mutation',
    async (scenario) => {
      const userId = await createUser()
      const owner = { kind: 'USER' as const, id: userId }
      const legacy = await createSession({
        owner,
        expiresAt: new Date(NOW.getTime() + DAY_MS),
        status: 'SUBMITTED',
        submittedIsCorrect: false,
        recordReview: true
      })
      const note = await database.client.wrongNote.findUniqueOrThrow({
        where: {
          userId_questionId: { userId, questionId: getPinnedQuestion().id }
        }
      })
      const worker = makeClient()
      let unlock = () => {}
      let locked = () => {}
      const ready = new Promise<void>((resolve) => {
        locked = resolve
      })
      const release = new Promise<void>((resolve) => {
        unlock = resolve
      })
      const pidRows = await retirementClient.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`
      const blockerPid = pidRows[0]?.pid
      if (!blockerPid) throw new Error('Missing blocker PID.')
      const lock = retirementClient.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE "nihongo_phase7_owner"`
        await tx.$queryRaw`SELECT "id" FROM "StudySession" WHERE "id" = ${legacy.sessionId}::uuid FOR UPDATE`
        await tx.$queryRaw`SELECT "id" FROM "WrongNote" WHERE "id" = ${note.id}::uuid FOR UPDATE`
        locked()
        await release
      })
      try {
        await ready
        const workerRows = await worker.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`
        const workerPid = workerRows[0]?.pid
        if (!workerPid) throw new Error('Missing retirement backend PID.')
        const retryProgress: {
          pid: number | undefined
          state: 'pending' | 'fulfilled' | 'rejected'
          stage: string
        } = {
          pid: undefined,
          state: 'pending',
          stage: 'starting'
        }
        const retirement = createPrismaStudyV1RetirementRepository(
          worker
        ).retire([legacy.sessionId])
        const mutation =
          scenario === 'memo'
            ? database.client.userMemo.create({
                data: {
                  wrongNoteId: note.id,
                  text: 'concurrent memo',
                  createdAt: new Date(NOW.getTime() + 2 * DAY_MS),
                  updatedAt: new Date(NOW.getTime() + 2 * DAY_MS)
                }
              })
            : createSession({
                owner,
                expiresAt: new Date(NOW.getTime() + 2 * DAY_MS),
                ...(scenario === 'retry'
                  ? {
                      retryOfStudySessionId: legacy.sessionId,
                      onTransactionStarted: (pid: number) => {
                        retryProgress.pid = pid
                      },
                      onTransactionStage: (stage: string) => {
                        retryProgress.stage = stage
                      }
                    }
                  : {
                      practiceContractVersion: 2 as const,
                      status: 'SUBMITTED' as const,
                      submittedIsCorrect: false,
                      recordReview: true
                    })
              })
        if (scenario === 'retry') {
          void mutation.then(
            () => {
              retryProgress.state = 'fulfilled'
            },
            () => {
              retryProgress.state = 'rejected'
            }
          )
        }
        const pending = Promise.allSettled([retirement, mutation])
        let raceObserved = false
        let retryObservation = ''
        const deadline = Date.now() + 1_000
        while (Date.now() < deadline) {
          if (scenario === 'retry' && retryProgress.pid) {
            const rows: {
              workerBlockedBy: number[]
              retryBlockedBy: number[]
              workerWait: string | null
              retryWait: string | null
            }[] = await database.client.$queryRaw`
              SELECT pg_catalog.pg_blocking_pids(${workerPid}::integer) AS "workerBlockedBy",
                     pg_catalog.pg_blocking_pids(${retryProgress.pid}::integer) AS "retryBlockedBy",
                     (SELECT wait_event FROM pg_catalog.pg_stat_activity WHERE pid = ${workerPid}::integer) AS "workerWait",
                     (SELECT wait_event FROM pg_catalog.pg_stat_activity WHERE pid = ${retryProgress.pid}::integer) AS "retryWait"`
            const workerBlockedBy: number[] = rows[0]?.workerBlockedBy ?? []
            const retryBlockedBy: number[] = rows[0]?.retryBlockedBy ?? []
            retryObservation = `blockerPid=${blockerPid} workerPid=${workerPid} retryPid=${retryProgress.pid} retirementBlockedBy=${workerBlockedBy.join(',')} workerWait=${rows[0]?.workerWait} retryBlockedBy=${retryBlockedBy.join(',')} retryWait=${rows[0]?.retryWait} retryStage=${retryProgress.stage} retryState=${retryProgress.state}`
            if (
              isRetryLockRaceObserved({
                blockerPid,
                workerPid,
                retryPid: retryProgress.pid,
                workerBlockedBy,
                retryBlockedBy,
                retryState: retryProgress.state
              })
            ) {
              raceObserved = true
              break
            }
            if (retryProgress.state === 'rejected') break
          } else if (scenario !== 'retry') {
            const rows = await database.client.$queryRaw<{ count: bigint }[]>`
              SELECT count(*) AS count FROM pg_catalog.pg_stat_activity
              WHERE ${blockerPid}::integer = ANY(pg_catalog.pg_blocking_pids(pid))`
            if ((rows[0]?.count ?? 0n) >= 2n) {
              raceObserved = true
              break
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        unlock()
        await lock
        const results = await pending
        expect(raceObserved, retryObservation).toBe(true)
        if (scenario === 'retry') {
          console.info(`retry lock observation: ${retryObservation}`)
          if (results[1]?.status === 'rejected') {
            expect(isRetryConcurrencyConflict(results[1].reason)).toBe(true)
            expect(
              await database.client.studySession.count({
                where: { retryOfStudySessionId: legacy.sessionId }
              })
            ).toBe(0)
            const source = await database.client.studySession.findUnique({
              where: { id: legacy.sessionId }
            })
            const sourceResult = await database.client.studyResult.findUnique({
              where: { studySessionId: legacy.sessionId }
            })
            const sourceNote = await database.client.wrongNote.findUnique({
              where: { id: note.id }
            })
            expect(sourceResult === null).toBe(source === null)
            expect(sourceNote === null).toBe(source === null)
          }
        }
        if (scenario === 'retry') {
          expect(results.some((result) => result.status === 'fulfilled')).toBe(
            true
          )
        } else {
          if (results[0]?.status === 'rejected') {
            expect(
              isReviewMemoConcurrencyConflict(
                results[0].reason,
                scenario,
                false
              )
            ).toBe(true)
          }
          if (results[1]?.status === 'rejected') {
            expect(results[0]?.status).toBe('fulfilled')
          }
        }
        if (scenario !== 'retry' && results[1]?.status === 'rejected') {
          const source = await database.client.studySession.findUnique({
            where: { id: legacy.sessionId }
          })
          expect(
            isReviewMemoConcurrencyConflict(
              results[1].reason,
              scenario,
              source === null
            )
          ).toBe(true)
          const sourceResult = await database.client.studyResult.findUnique({
            where: { studySessionId: legacy.sessionId }
          })
          const sourceNote = await database.client.wrongNote.findUnique({
            where: { id: note.id }
          })
          expect(sourceResult === null).toBe(source === null)
          expect(sourceNote === null).toBe(source === null)
          expect(
            await database.client.userMemo.findUnique({
              where: { wrongNoteId: note.id }
            })
          ).toBeNull()
          expect(
            await database.client.reviewEvent.count({
              where: { userId, studySession: { practiceContractVersion: 2 } }
            })
          ).toBe(0)
        }
        if (results[1]?.status === 'fulfilled') {
          if (scenario === 'retry') {
            expect(
              await database.client.studySession.findUnique({
                where: { id: legacy.sessionId }
              })
            ).not.toBeNull()
            expect(
              await database.client.studySession.count({
                where: {
                  retryOfStudySessionId: legacy.sessionId,
                  practiceContractVersion: 2
                }
              })
            ).toBe(1)
            expect(
              await database.client.wrongNote.findUnique({
                where: { id: note.id }
              })
            ).not.toBeNull()
            expect(
              await database.client.studyResult.findUnique({
                where: { studySessionId: legacy.sessionId }
              })
            ).not.toBeNull()
          } else if (scenario === 'memo') {
            expect(
              await database.client.userMemo.findUnique({
                where: { wrongNoteId: note.id }
              })
            ).toMatchObject({ text: 'concurrent memo' })
            expect(
              await database.client.studySession.findUnique({
                where: { id: legacy.sessionId }
              })
            ).not.toBeNull()
          } else {
            expect(
              await database.client.reviewEvent.count({
                where: {
                  userId,
                  questionId: getPinnedQuestion().id,
                  studySession: { practiceContractVersion: 2 }
                }
              })
            ).toBe(1)
            expect(
              await database.client.studySession.findUnique({
                where: { id: legacy.sessionId }
              })
            ).not.toBeNull()
          }
        }
        expect(
          await fixtureDatabase.client.user.findUnique({
            where: { id: userId }
          })
        ).not.toBeNull()
        expect(
          await database.client.question.findUnique({
            where: { id: getPinnedQuestion().id }
          })
        ).not.toBeNull()
      } finally {
        unlock()
        await lock.catch(() => undefined)
        await worker.$disconnect()
      }
    },
    15_000
  )

  it.each(['same', 'overlap'] as const)(
    'serializes %s target sets and permits a safe retry',
    async (scenario) => {
      const userId = await createUser()
      const owner = { kind: 'USER' as const, id: userId }
      const first = await createSession({
        owner,
        expiresAt: new Date(NOW.getTime() + DAY_MS),
        status: 'SUBMITTED'
      })
      const second = await createSession({
        owner,
        expiresAt: new Date(NOW.getTime() + DAY_MS),
        status: 'SUBMITTED'
      })
      const untouched = await createSession({
        owner,
        expiresAt: new Date(NOW.getTime() + DAY_MS),
        status: 'SUBMITTED',
        practiceContractVersion: 2
      })
      const workers = [makeClient(), makeClient()]
      let unlock = () => {}
      let locked = () => {}
      const ready = new Promise<void>((resolve) => {
        locked = resolve
      })
      const release = new Promise<void>((resolve) => {
        unlock = resolve
      })
      const lock = retirementClient.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE "nihongo_phase7_owner"`
        await tx.$queryRaw`SELECT "id" FROM "StudySession" WHERE "id" IN (${first.sessionId}::uuid, ${second.sessionId}::uuid) ORDER BY "id" FOR UPDATE`
        locked()
        await release
      })
      try {
        await ready
        const pids = await Promise.all(
          workers.map(async (worker) => {
            const rows = await worker.$queryRaw<
              { pid: number }[]
            >`SELECT pg_backend_pid() AS pid`
            if (!rows[0]) throw new Error('Missing retirement backend PID.')
            return rows[0].pid
          })
        )
        const ids =
          scenario === 'same'
            ? [[first.sessionId], [first.sessionId]]
            : [[first.sessionId, second.sessionId], [second.sessionId]]
        const pending = Promise.allSettled(
          workers.map((worker, index) =>
            createPrismaStudyV1RetirementRepository(worker).retire(
              ids[index] ?? []
            )
          )
        )
        let bothBlocked = false
        const deadline = Date.now() + 1_000
        while (Date.now() < deadline) {
          const state = await database.client.$queryRaw<{ blocked: boolean }[]>`
            SELECT cardinality(pg_blocking_pids(${pids[0]}::integer)) > 0
              AND cardinality(pg_blocking_pids(${pids[1]}::integer)) > 0 AS blocked`
          if (state[0]?.blocked) {
            bothBlocked = true
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        unlock()
        await lock
        const results = await pending
        expect(bothBlocked).toBe(true)
        expect(results.some((result) => result.status === 'fulfilled')).toBe(
          true
        )
        await createPrismaStudyV1RetirementRepository(retirementClient).retire(
          scenario === 'same'
            ? [first.sessionId]
            : [first.sessionId, second.sessionId]
        )
        expect(
          await database.client.studySession.findUnique({
            where: { id: first.sessionId }
          })
        ).toBeNull()
        expect(
          await database.client.studySession.findUnique({
            where: { id: second.sessionId }
          })
        ).toEqual(
          scenario === 'same'
            ? expect.objectContaining({ id: second.sessionId })
            : null
        )
        expect(
          await database.client.studySession.findUnique({
            where: { id: untouched.sessionId }
          })
        ).toMatchObject({ practiceContractVersion: 2 })
      } finally {
        unlock()
        await lock.catch(() => undefined)
        await Promise.all(workers.map(async (worker) => worker.$disconnect()))
      }
    },
    15_000
  )
})

describe('V1 retirement TEST command fixture', () => {
  it('runs the guarded command with the canonical wrapper for an explicit V1 fixture', async () => {
    const userId = await createUser()
    const legacy = await createSession({
      owner: { kind: 'USER', id: userId },
      expiresAt: new Date(NOW.getTime() + DAY_MS)
    })
    const run = promisify(execFile)
    const { stdout } = await run(
      process.execPath,
      ['--import', 'tsx', 'src/study/studyV1RetirementCommand.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_URL:
            process.env.PHASE7_RUNTIME_DATABASE_URL ?? environment.DATABASE_URL,
          PHASE7_MIGRATION_DATABASE_URL:
            process.env.PHASE7_MIGRATION_DATABASE_URL ??
            process.env.PRISMA_TEST_DATABASE_URL,
          STUDY_V1_RETIRE_SESSION_IDS: legacy.sessionId
        }
      }
    )
    expect(JSON.parse(stdout)).toMatchObject({
      event: 'study.v1.retirement.completed',
      deletedSessionCount: 1,
      expiredCount: 1
    })
    expect(
      await database.client.studySession.findUnique({
        where: { id: legacy.sessionId }
      })
    ).toBeNull()
  })
})

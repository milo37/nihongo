import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { createPrismaStudySessionCleanupRepository } from './studySessionCleanupRepository.js'
import { createStudySessionCleanupService } from './studySessionCleanupService.js'

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS
const NOW = new Date('2000-01-01T12:00:00.000Z')

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
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
  const user = await database.client.user.create({
    data: {
      name: 'Cleanup fixture user',
      email: `slice3-cleanup-${randomUUID()}@example.test`,
      emailVerified: true
    },
    select: { id: true }
  })
  createdUserIds.add(user.id)
  return user.id
}

const createSession = async ({
  expiresAt,
  owner,
  status = 'IN_PROGRESS'
}: {
  expiresAt: Date
  owner: SessionOwner
  status?: FixtureSessionStatus
}): Promise<{ childId: string; sessionId: string }> => {
  const question = getPinnedQuestion()
  const startedAt = new Date(expiresAt.getTime() - DAY_MS)
  const childId = randomUUID()
  const sessionId = await database.client.$transaction(async (transaction) => {
    const session = await transaction.studySession.create({
      data: {
        ...(owner.kind === 'USER'
          ? { userId: owner.id }
          : { guestPrincipalId: owner.id }),
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        requestedCount: 1,
        actualCount: 1,
        usedFallback: false,
        startedAt,
        expiresAt
      },
      select: { id: true }
    })
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

    const terminalAt = new Date(startedAt.getTime() + HOUR_MS)
    if (status === 'SUBMITTED') {
      const idempotencyRecordId = randomUUID()
      const submissionHash = 'a'.repeat(64)
      await transaction.studyAnswer.create({
        data: {
          id: randomUUID(),
          studySessionQuestionId: childId,
          questionVersionId: question.questionVersionId,
          selectedOptionId: question.correctOptionId,
          isCorrect: true,
          elapsedSec: 60,
          gradingVersion: 'server-grading-v1',
          answeredAt: terminalAt,
          gradedAt: terminalAt
        }
      })
      await transaction.studyResult.create({
        data: {
          id: randomUUID(),
          studySessionId: session.id,
          totalCount: 1,
          correctCount: 1,
          incorrectCount: 0,
          correctRateBasisPoints: 10_000,
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

    return session.id
  })
  createdSessionIds.add(sessionId)
  return { childId, sessionId }
}

beforeAll(async () => {
  await database.checkReadiness()
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

afterAll(async () => {
  if (createdUserIds.size > 0) {
    await database.client.user.deleteMany({
      where: { id: { in: [...createdUserIds] } }
    })
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
  await database.disconnect()
})

describe('StudySession bounded retention cleanup', () => {
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
      expiresAt: new Date(NOW.getTime() - 2 * HOUR_MS)
    })
    const newer = await createSession({
      owner: { kind: 'GUEST', id: newerGuestId },
      expiresAt: new Date(NOW.getTime() - HOUR_MS)
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
      expiresAt: new Date(NOW.getTime() - 3 * HOUR_MS),
      status: 'CANCELLED'
    })
    await createSession({
      owner: { kind: 'GUEST', id: expiredStatusGuestId },
      expiresAt: new Date(NOW.getTime() - 3 * HOUR_MS),
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

  it('참조 없는 만료 GuestPrincipal만 bounded·idempotent하게 삭제한다', async () => {
    const oldestOrphanId = await createGuestPrincipal(
      new Date(NOW.getTime() - 3 * HOUR_MS)
    )
    const newerOrphanId = await createGuestPrincipal(
      new Date(NOW.getTime() - 2 * HOUR_MS)
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
      new Date(NOW.getTime() - HOUR_MS)
    )
    const session = await createSession({
      owner: { kind: 'GUEST', id: guestId },
      expiresAt: new Date(NOW.getTime() - 2 * HOUR_MS)
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

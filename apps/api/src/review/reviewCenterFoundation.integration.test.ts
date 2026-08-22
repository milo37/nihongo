import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { PracticeCompatibilityFenceError } from '../db/practiceCompatibilityFence.js'
import { Prisma } from '../generated/prisma/client.js'
import { toVersionedStudySessionPayload } from '../study/studySessionMapper.js'
import { createPrismaStudySessionRepository } from '../study/studySessionRepository.js'
import { createPrismaReviewReconciliationRepository } from './reviewReconciliationRepository.js'
import { REVIEW_RECONCILIATION_CONFIRMATION } from './reviewReconciliationCommandConfig.js'

const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS
const NOW = new Date('2026-08-21T12:00:00.000Z')
const execFileAsync = promisify(execFile)
const apiRoot = fileURLToPath(new URL('../../', import.meta.url))

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
const sessionRepository = createPrismaStudySessionRepository(database.client)
const createdUserIds = new Set<string>()

interface CommandFailure extends Error {
  readonly code: number | string
  readonly stderr: string
  readonly stdout: string
}

const isCommandFailure = (error: unknown): error is CommandFailure =>
  error instanceof Error &&
  'code' in error &&
  'stdout' in error &&
  'stderr' in error &&
  (typeof error.code === 'number' || typeof error.code === 'string') &&
  typeof error.stdout === 'string' &&
  typeof error.stderr === 'string'

const createUser = async (): Promise<string> => {
  const user = await database.client.user.create({
    data: {
      name: 'Phase 5 review foundation user',
      email: `phase5-review-foundation-${randomUUID()}@example.test`,
      emailVerified: true
    },
    select: { id: true }
  })
  createdUserIds.add(user.id)
  return user.id
}

const createWrongNote = async (userId: string) => {
  const startedAt = new Date(NOW.getTime() - HOUR_MS)
  const question = await database.client.question.findFirstOrThrow({
    where: {
      lifecycleStatus: 'ACTIVE',
      currentPublishedVersionId: { not: null },
      currentPublishedVersion: {
        status: 'PUBLISHED',
        level: 'N5',
        subject: 'VOCABULARY'
      }
    },
    select: { id: true, currentPublishedVersionId: true }
  })
  if (question.currentPublishedVersionId === null) {
    throw new Error('Phase 5 review fixture에 published version이 필요합니다.')
  }
  const sessionId = randomUUID()
  const sessionQuestionId = randomUUID()
  const answerId = randomUUID()
  const idempotencyRecordId = randomUUID()
  const wrongNoteId = randomUUID()
  const submissionHash = 'a'.repeat(64)

  await database.client.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "StudySession" (
        "id", "userId", "level", "subject", "mode", "status",
        "requestedCount", "actualCount", "usedFallback", "startedAt",
        "expiresAt", "practiceContractVersion", "createdAt", "updatedAt"
      ) VALUES (
        ${sessionId}::uuid, ${userId}::uuid, 'N5', 'VOCABULARY', 'RANDOM',
        'IN_PROGRESS', 1, 1, false, ${startedAt},
        ${new Date(startedAt.getTime() + DAY_MS)}, 1, ${startedAt}, ${startedAt}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "StudySessionQuestion" (
        "id", "studySessionId", "questionId", "questionVersionId",
        "ordinal", "createdAt"
      ) VALUES (
        ${sessionQuestionId}::uuid, ${sessionId}::uuid, ${question.id}::uuid,
        ${question.currentPublishedVersionId}::uuid, 1, ${startedAt}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "IdempotencyRecord" (
        "id", "principalType", "userId", "guestPrincipalId",
        "operation", "idempotencyKey", "studySessionId", "requestHash",
        "contractVersion", "state", "createdAt"
      ) VALUES (
        ${idempotencyRecordId}::uuid, 'USER', ${userId}::uuid, NULL,
        'STUDY_SUBMIT', ${randomUUID()}::uuid, ${sessionId}::uuid,
        ${submissionHash}, 1, 'PROCESSING', ${startedAt}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "StudyAnswer" (
        "id", "studySessionQuestionId", "questionVersionId",
        "selectedOptionId", "isCorrect", "elapsedSec", "gradingVersion",
        "answeredAt", "gradedAt"
      ) VALUES (
        ${answerId}::uuid, ${sessionQuestionId}::uuid,
        ${question.currentPublishedVersionId}::uuid, NULL, false, 0,
        'server-grading-v1', ${NOW}, ${NOW}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "WrongNote" (
        "id", "userId", "questionId", "lastWrongQuestionVersionId",
        "currentReviewQuestionVersionId", "wrongCount", "correctStreak",
        "status", "lastWrongAt", "lastReviewedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${wrongNoteId}::uuid, ${userId}::uuid, ${question.id}::uuid,
        ${question.currentPublishedVersionId}::uuid, NULL, 1, 0, 'NEW',
        ${NOW}, NULL, ${NOW}, ${NOW}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "ReviewSchedule" (
        "id", "wrongNoteId", "nextReviewAt", "intervalDays",
        "algorithmVersion", "updatedAt"
      ) VALUES (
        ${randomUUID()}::uuid, ${wrongNoteId}::uuid,
        ${new Date(NOW.getTime() + DAY_MS)}, 1, 1, ${NOW}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "ReviewEvent" (
        "id", "wrongNoteId", "userId", "questionId", "questionVersionId",
        "source", "studySessionId", "studyAnswerId", "selectedOptionId",
        "isCorrect", "previousStatus", "nextStatus",
        "previousCorrectStreak", "nextCorrectStreak", "previousWrongCount",
        "wrongCountAfter", "algorithmVersion", "occurredAt"
      ) VALUES (
        ${randomUUID()}::uuid, ${wrongNoteId}::uuid, ${userId}::uuid,
        ${question.id}::uuid, ${question.currentPublishedVersionId}::uuid,
        'STUDY_SUBMIT', ${sessionId}::uuid, ${answerId}::uuid, NULL, false,
        NULL, 'NEW', NULL, 0, NULL, 1, 1, ${NOW}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "StudyResult" (
        "id", "studySessionId", "totalCount", "correctCount",
        "incorrectCount", "correctRateBasisPoints", "durationSec",
        "gradingVersion", "createdAt"
      ) VALUES (
        ${randomUUID()}::uuid, ${sessionId}::uuid, 1, 0, 1, 0, 0,
        'server-grading-v1', ${NOW}
      )
    `
    await transaction.$executeRaw`
      UPDATE "StudySession"
      SET "status" = 'SUBMITTED', "submittedAt" = ${NOW},
          "durationSec" = 0, "submissionHash" = ${submissionHash},
          "updatedAt" = ${NOW}
      WHERE "id" = ${sessionId}::uuid
    `
    await transaction.$executeRaw`
      UPDATE "IdempotencyRecord"
      SET "state" = 'SUCCEEDED', "responseStatus" = 201,
          "responseBody" = JSONB_BUILD_OBJECT('sessionId', ${sessionId}::text),
          "completedAt" = ${NOW},
          "expiresAt" = ${new Date(NOW.getTime() + DAY_MS)}
      WHERE "id" = ${idempotencyRecordId}::uuid
    `
    await transaction.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`
  })

  return await database.client.wrongNote.findFirstOrThrow({
    where: { id: wrongNoteId },
    include: { schedule: true }
  })
}

beforeAll(async () => {
  await database.checkReadiness()
})

afterEach(async () => {
  if (createdUserIds.size > 0) {
    await database.client.user.deleteMany({
      where: { id: { in: [...createdUserIds] } }
    })
    createdUserIds.clear()
  }
})

afterAll(async () => {
  await database.disconnect()
})

describe('Phase 5 review-center data foundation', () => {
  it('UserMemo 1:0..1, normalization, code-point, timestamp와 cascade invariant를 강제한다', async () => {
    const userId = await createUser()
    const wrongNote = await createWrongNote(userId)
    const memoId = randomUUID()

    await expect(database.checkV1Compatibility()).resolves.toBeUndefined()
    await database.client.userMemo.create({
      data: {
        id: memoId,
        wrongNoteId: wrongNote.id,
        text: '복습 메모 🙂',
        createdAt: NOW,
        updatedAt: NOW
      }
    })
    await expect(database.checkV1Compatibility()).rejects.toBeInstanceOf(
      PracticeCompatibilityFenceError
    )

    await expect(
      database.client.userMemo.create({
        data: {
          id: randomUUID(),
          wrongNoteId: wrongNote.id,
          text: '중복 메모',
          createdAt: NOW,
          updatedAt: NOW
        }
      })
    ).rejects.toMatchObject({ code: 'P2002' })

    for (const invalidText of [' 앞뒤 공백 ', '🙂'.repeat(2001)]) {
      await expect(
        database.client.$executeRaw`
          UPDATE "UserMemo"
          SET "text" = ${invalidText}
          WHERE "id" = ${memoId}::uuid
        `
      ).rejects.toMatchObject({ code: 'P2010' })
    }
    await expect(
      database.client.$executeRaw`
        UPDATE "UserMemo"
        SET "updatedAt" = "createdAt" - INTERVAL '1 millisecond'
        WHERE "id" = ${memoId}::uuid
      `
    ).rejects.toMatchObject({ code: 'P2010' })

    const twoThousandCodePoints = '🙂'.repeat(2000)
    await database.client.userMemo.update({
      where: { id: memoId },
      data: {
        text: twoThousandCodePoints,
        updatedAt: new Date(NOW.getTime() + 1)
      }
    })
    expect(
      await database.client.$queryRaw<{ length: number }[]>`
        SELECT char_length("text")::int AS length
        FROM "UserMemo"
        WHERE "id" = ${memoId}::uuid
      `
    ).toEqual([{ length: 2000 }])

    const originalQuestion = await database.client.question.findUniqueOrThrow({
      where: { id: wrongNote.questionId },
      select: {
        archivedAt: true,
        currentPublishedVersionId: true,
        lifecycleStatus: true,
        updatedAt: true
      }
    })
    try {
      await database.client.question.update({
        where: { id: wrongNote.questionId },
        data: {
          archivedAt: new Date(NOW.getTime() + HOUR_MS),
          currentPublishedVersionId: null,
          lifecycleStatus: 'ARCHIVED'
        }
      })
      await expect(
        database.client.userMemo.findUnique({ where: { id: memoId } })
      ).resolves.toMatchObject({ wrongNoteId: wrongNote.id })
    } finally {
      await database.client.question.update({
        where: { id: wrongNote.questionId },
        data: originalQuestion
      })
    }

    await database.client.userMemo.delete({ where: { id: memoId } })
    await expect(database.checkV1Compatibility()).resolves.toBeUndefined()
    await database.client.userMemo.create({
      data: {
        id: memoId,
        wrongNoteId: wrongNote.id,
        text: 'cascade 확인',
        createdAt: NOW,
        updatedAt: NOW
      }
    })
    await database.client.user.delete({ where: { id: userId } })
    createdUserIds.delete(userId)
    expect(
      await database.client.userMemo.count({ where: { id: memoId } })
    ).toBe(0)
  })

  it('clean review chain은 0이고 drift는 category로 탐지하되 어떤 row도 수정하지 않는다', async () => {
    const userId = await createUser()
    const wrongNote = await createWrongNote(userId)
    const repository = createPrismaReviewReconciliationRepository(
      database.client
    )

    const clean = await repository.reconcile({ batchSize: 1 })
    expect(clean.mismatchWrongNoteCount).toBe(0)
    expect(clean.categories.every(({ count }) => count === 0)).toBe(true)

    await database.client.$executeRawUnsafe(
      'ALTER TABLE "ReviewSchedule" DISABLE TRIGGER USER'
    )
    try {
      await database.client.reviewSchedule.update({
        where: { wrongNoteId: wrongNote.id },
        data: {
          intervalDays: wrongNote.schedule?.intervalDays === 7 ? 14 : 7
        }
      })
    } finally {
      await database.client.$executeRawUnsafe(
        'ALTER TABLE "ReviewSchedule" ENABLE TRIGGER USER'
      )
    }

    const before = await database.client.reviewSchedule.findUniqueOrThrow({
      where: { wrongNoteId: wrongNote.id }
    })
    const drift = await repository.reconcile({ batchSize: 1 })
    const after = await database.client.reviewSchedule.findUniqueOrThrow({
      where: { wrongNoteId: wrongNote.id }
    })

    expect(drift.mismatchWrongNoteCount).toBeGreaterThanOrEqual(1)
    expect(drift.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'REVIEW_SCHEDULE', count: 1 })
      ])
    )
    expect(after).toEqual(before)
  })

  it('multi-page reconciliation이 모든 drift category를 redacted CLI exit 1로 보고하고 repair하지 않는다', async () => {
    const corruptUserId = await createUser()
    const cleanUserId = await createUser()
    const corruptWrongNote = await createWrongNote(corruptUserId)
    await createWrongNote(cleanUserId)
    const event = await database.client.reviewEvent.findFirstOrThrow({
      where: { wrongNoteId: corruptWrongNote.id },
      select: {
        id: true,
        occurredAt: true,
        questionId: true,
        questionVersionId: true,
        userId: true
      }
    })
    const alternateOption =
      await database.client.questionOption.findFirstOrThrow({
        where: { questionVersionId: event.questionVersionId },
        select: { id: true }
      })
    const rebaseEventId = 'ffffffff-ffff-4fff-bfff-ffffffffffff'

    for (const tableName of ['ReviewEvent', 'WrongNote', 'ReviewSchedule']) {
      await database.client.$executeRawUnsafe(
        `ALTER TABLE "${tableName}" DISABLE TRIGGER USER`
      )
    }
    try {
      await database.client.$executeRaw`
        UPDATE "ReviewEvent"
        SET
          "source" = 'WRONG_NOTE_REVIEW',
          "selectedOptionId" = ${alternateOption.id}::uuid
        WHERE "id" = ${event.id}::uuid
      `
      await database.client.$executeRaw`
        INSERT INTO "ReviewEvent" (
          "id", "wrongNoteId", "userId", "questionId", "questionVersionId",
          "source", "studySessionId", "studyAnswerId", "selectedOptionId",
          "isCorrect", "previousStatus", "nextStatus",
          "previousCorrectStreak", "nextCorrectStreak", "previousWrongCount",
          "wrongCountAfter", "algorithmVersion", "occurredAt"
        ) VALUES (
          ${rebaseEventId}::uuid, ${corruptWrongNote.id}::uuid,
          ${event.userId}::uuid, ${event.questionId}::uuid,
          ${event.questionVersionId}::uuid, 'VERSION_REBASE',
          NULL, NULL, NULL, NULL, 'NEW', 'NEW', 0, 0, 1, 1, 1,
          ${event.occurredAt}
        )
      `
      await database.client.$executeRaw`
        UPDATE "WrongNote"
        SET "lastWrongAt" = "lastWrongAt" + INTERVAL '1 hour'
        WHERE "id" = ${corruptWrongNote.id}::uuid
      `
      await database.client.$executeRaw`
        UPDATE "ReviewSchedule"
        SET "intervalDays" = 7
        WHERE "wrongNoteId" = ${corruptWrongNote.id}::uuid
      `
    } finally {
      for (const tableName of ['ReviewSchedule', 'WrongNote', 'ReviewEvent']) {
        await database.client.$executeRawUnsafe(
          `ALTER TABLE "${tableName}" ENABLE TRIGGER USER`
        )
      }
    }

    const readCorruptRows = async () => ({
      events: await database.client.reviewEvent.findMany({
        where: { wrongNoteId: corruptWrongNote.id },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }]
      }),
      note: await database.client.wrongNote.findUniqueOrThrow({
        where: { id: corruptWrongNote.id }
      }),
      schedule: await database.client.reviewSchedule.findUniqueOrThrow({
        where: { wrongNoteId: corruptWrongNote.id }
      })
    })
    const before = await readCorruptRows()
    const result = await createPrismaReviewReconciliationRepository(
      database.client
    ).reconcile({ batchSize: 1 })
    const after = await readCorruptRows()

    expect(result.scannedWrongNoteCount).toBe(2)
    expect(result.mismatchWrongNoteCount).toBe(1)
    expect(result.categories).toEqual(
      expect.arrayContaining(
        [
          'EVENT_CHAIN',
          'MATERIALIZED_WRONG_NOTE',
          'REVIEW_SCHEDULE',
          'EVIDENCE_PIN',
          'SOURCE_MODE'
        ].map((category) => expect.objectContaining({ category, count: 1 }))
      )
    )
    expect(after).toEqual(before)

    let commandFailure: CommandFailure | undefined
    try {
      await execFileAsync(
        'pnpm',
        ['exec', 'tsx', 'src/review/reviewReconciliationCommand.ts'],
        {
          cwd: apiRoot,
          env: {
            ...process.env,
            DATABASE_URL: environment.DATABASE_URL,
            NODE_ENV: 'test',
            REVIEW_RECONCILIATION_BATCH_SIZE: '1',
            REVIEW_RECONCILIATION_CONFIRM: REVIEW_RECONCILIATION_CONFIRMATION
          }
        }
      )
    } catch (error) {
      if (!isCommandFailure(error)) {
        throw error
      }
      commandFailure = error
    }
    expect(commandFailure?.code).toBe(1)
    const commandOutput = commandFailure?.stdout ?? ''
    expect(commandOutput).toContain('"event":"review.reconciliation.completed"')
    expect(commandOutput).toContain('"mismatchWrongNoteCount":1')
    expect(commandOutput).not.toMatch(
      /answer|idempotency|memo|payload|questionId|requestHash|userId|wrongNoteId/i
    )
    expect(commandOutput).not.toContain(corruptWrongNote.id)
    expect(commandFailure?.stderr ?? '').not.toContain(corruptWrongNote.id)
  }, 20_000)

  it('targeted v2 session의 owner·pin·initial draft·pointer·stored response를 commit 시 검증한다', async () => {
    const userId = await createUser()
    const wrongNote = await createWrongNote(userId)
    const targetStartedAt = new Date(NOW.getTime() + HOUR_MS)
    const target = (
      await sessionRepository.create({
        owner: { kind: 'USER', userId },
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'WRONG_NOTE',
        requestedCount: 1,
        startedAt: targetStartedAt,
        expiresAt: new Date(targetStartedAt.getTime() + DAY_MS),
        practiceContractVersion: 2
      })
    ).session
    const response = toVersionedStudySessionPayload(target)
    const completedAt = new Date(targetStartedAt.getTime() + 1_000)

    const targetedRecordId = await database.client.$transaction(
      async (transaction) => {
        const record = await transaction.idempotencyRecord.create({
          data: {
            id: randomUUID(),
            principalType: 'USER',
            userId,
            guestPrincipalId: null,
            operation: 'STUDY_TARGETED_REVIEW_CREATE',
            idempotencyKey: randomUUID(),
            studySessionId: target.id,
            requestHash: 'd'.repeat(64),
            contractVersion: 2,
            state: 'PROCESSING',
            createdAt: targetStartedAt
          },
          select: { id: true }
        })
        await transaction.idempotencyRecord.update({
          where: { id: record.id },
          data: {
            state: 'SUCCEEDED',
            responseStatus: 201,
            responseBody: response as Prisma.InputJsonValue,
            completedAt,
            expiresAt: new Date(completedAt.getTime() + 7 * DAY_MS)
          }
        })
        return record.id
      }
    )

    await expect(
      database.client.idempotencyRecord.delete({
        where: { id: targetedRecordId }
      })
    ).rejects.toThrow('Active IdempotencyRecord cannot be deleted.')

    await expect(
      database.client.$transaction(async (transaction) => {
        const record = await transaction.idempotencyRecord.create({
          data: {
            id: randomUUID(),
            principalType: 'USER',
            userId,
            guestPrincipalId: null,
            operation: 'STUDY_TARGETED_REVIEW_CREATE',
            idempotencyKey: randomUUID(),
            studySessionId: target.id,
            requestHash: 'e'.repeat(64),
            contractVersion: 2,
            state: 'PROCESSING',
            createdAt: targetStartedAt
          },
          select: { id: true }
        })
        await transaction.idempotencyRecord.update({
          where: { id: record.id },
          data: {
            state: 'SUCCEEDED',
            responseStatus: 201,
            responseBody: {
              ...response,
              session: { ...response.session, actualCount: 2 }
            } as Prisma.InputJsonValue,
            completedAt,
            expiresAt: new Date(completedAt.getTime() + 7 * DAY_MS)
          }
        })
      })
    ).rejects.toThrow()

    expect(
      await database.client.wrongNote.findUniqueOrThrow({
        where: { id: wrongNote.id },
        select: { currentReviewQuestionVersionId: true }
      })
    ).toEqual({
      currentReviewQuestionVersionId:
        target.questions[0]?.question.questionVersionId
    })
    expect(
      await database.client.studyDraft.findUniqueOrThrow({
        where: { studySessionId: target.id },
        include: { answers: true }
      })
    ).toMatchObject({
      revision: 0,
      currentOrdinal: 1,
      savedAt: null,
      answers: [{ selectedOptionId: null, elapsedSec: 0 }]
    })
    expect(
      await database.client.reviewEvent.count({
        where: { studySessionId: target.id }
      })
    ).toBe(0)
    expect(
      await database.client.studyAnswer.count({
        where: { studySessionQuestion: { studySessionId: target.id } }
      })
    ).toBe(0)
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: target.id }
      })
    ).toBe(0)
    expect(
      await database.client.idempotencyRecord.count({
        where: {
          operation: 'STUDY_TARGETED_REVIEW_CREATE',
          studySessionId: target.id
        }
      })
    ).toBe(1)
  })
})

import { randomUUID } from 'node:crypto'
import {
  listReviewEventsResponseSchema,
  type ReviewEventHistoryItem
} from '@nihongo/contracts/wrong-note/list-review-events'
import { updateWrongNoteMemoBodySchema } from '@nihongo/contracts/wrong-note/update-wrong-note-memo'
import { assertNoReviewCenterForbiddenKeys } from '@nihongo/contracts/testing/review-center-conformance'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { ApplicationError } from '../errors/applicationError.js'
import { createPrismaWrongNoteReviewCenterRepository } from './wrongNoteReviewCenterRepository.js'
import {
  createWrongNoteReviewCenterService,
  type WrongNoteReviewCenterService
} from './wrongNoteReviewCenterService.js'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000
const SUBMITTED_AT = new Date('2026-08-22T00:00:00.000Z')
const HISTORY_CARDINALITY = 205

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
const repository = createPrismaWrongNoteReviewCenterRepository(database.client)
const service = createWrongNoteReviewCenterService(repository)
const createdUserIds = new Set<string>()

interface ReviewCenterFixture {
  readonly questionId: string
  readonly questionVersionId: string
  readonly userId: string
  readonly wrongNoteId: string
}

interface QuestionRestoreState {
  readonly archivedAt: Date | null
  readonly currentPublishedVersionId: string | null
  readonly lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  readonly questionId: string
}

let fixture: ReviewCenterFixture
let foreignUserId: string
let questionRestoreState: QuestionRestoreState | null = null

const createUser = async (label: string): Promise<string> => {
  const user = await database.client.user.create({
    data: {
      name: `Slice 2 review-center ${label}`,
      email: `slice2-review-${label}-${randomUUID()}@example.test`,
      emailVerified: true
    },
    select: { id: true }
  })
  createdUserIds.add(user.id)
  return user.id
}

const createInitialWrongNote = async (
  userId: string
): Promise<ReviewCenterFixture> => {
  const startedAt = new Date(SUBMITTED_AT.getTime() - 1_000)
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
    throw new Error(
      'Slice 2 review-center fixture에 published version이 필요합니다.'
    )
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
        ${new Date(startedAt.getTime() + DAY_MILLISECONDS)}, 1,
        ${startedAt}, ${startedAt}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "StudySessionQuestion" (
        "id", "studySessionId", "questionId", "questionVersionId",
        "ordinal", "createdAt"
      ) VALUES (
        ${sessionQuestionId}::uuid, ${sessionId}::uuid,
        ${question.id}::uuid, ${question.currentPublishedVersionId}::uuid,
        1, ${startedAt}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "IdempotencyRecord" (
        "id", "principalType", "userId", "guestPrincipalId", "operation",
        "idempotencyKey", "studySessionId", "requestHash",
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
        ${question.currentPublishedVersionId}::uuid, NULL, false, 9,
        'server-grading-v1', ${SUBMITTED_AT}, ${SUBMITTED_AT}
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
        ${SUBMITTED_AT}, NULL, ${SUBMITTED_AT}, ${SUBMITTED_AT}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "ReviewSchedule" (
        "id", "wrongNoteId", "nextReviewAt", "intervalDays",
        "algorithmVersion", "updatedAt"
      ) VALUES (
        ${randomUUID()}::uuid, ${wrongNoteId}::uuid,
        ${new Date(SUBMITTED_AT.getTime() + DAY_MILLISECONDS)}, 1, 1,
        ${SUBMITTED_AT}
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
        NULL, 'NEW', NULL, 0, NULL, 1, 1, ${SUBMITTED_AT}
      )
    `
    await transaction.$executeRaw`
      INSERT INTO "StudyResult" (
        "id", "studySessionId", "totalCount", "correctCount",
        "incorrectCount", "correctRateBasisPoints", "durationSec",
        "gradingVersion", "createdAt"
      ) VALUES (
        ${randomUUID()}::uuid, ${sessionId}::uuid, 1, 0, 1, 0, 9,
        'server-grading-v1', ${SUBMITTED_AT}
      )
    `
    await transaction.$executeRaw`
      UPDATE "StudySession"
      SET "status" = 'SUBMITTED', "submittedAt" = ${SUBMITTED_AT},
          "durationSec" = 9, "submissionHash" = ${submissionHash},
          "updatedAt" = ${SUBMITTED_AT}
      WHERE "id" = ${sessionId}::uuid
    `
    await transaction.$executeRaw`
      UPDATE "IdempotencyRecord"
      SET "state" = 'SUCCEEDED', "responseStatus" = 201,
          "responseBody" = JSONB_BUILD_OBJECT('sessionId', ${sessionId}::text),
          "completedAt" = ${SUBMITTED_AT},
          "expiresAt" = ${new Date(SUBMITTED_AT.getTime() + DAY_MILLISECONDS)}
      WHERE "id" = ${idempotencyRecordId}::uuid
    `
    await transaction.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`
  })

  return {
    userId,
    wrongNoteId,
    questionId: question.id,
    questionVersionId: question.currentPublishedVersionId
  }
}

const insertVersionRebaseEvents = async (
  target: ReviewCenterFixture,
  count: number,
  startingOffset: number
): Promise<void> => {
  await database.client.$executeRawUnsafe(
    'ALTER TABLE "ReviewEvent" DISABLE TRIGGER USER'
  )
  try {
    await database.client.$executeRaw`
      INSERT INTO "ReviewEvent" (
        "id", "wrongNoteId", "userId", "questionId", "questionVersionId",
        "source", "studySessionId", "studyAnswerId", "selectedOptionId",
        "isCorrect", "previousStatus", "nextStatus",
        "previousCorrectStreak", "nextCorrectStreak", "previousWrongCount",
        "wrongCountAfter", "algorithmVersion", "occurredAt"
      )
      SELECT
        gen_random_uuid(), ${target.wrongNoteId}::uuid, ${target.userId}::uuid,
        ${target.questionId}::uuid, ${target.questionVersionId}::uuid,
        'VERSION_REBASE', NULL, NULL, NULL, NULL,
        'NEW', 'NEW', 0, 0, 1, 1, 1,
        ${SUBMITTED_AT}::timestamptz
          + ((((${startingOffset} + series.position - 1) / 150) + 1)
            * INTERVAL '1 millisecond')
      FROM generate_series(1, ${count}) AS series(position)
    `
  } finally {
    await database.client.$executeRawUnsafe(
      'ALTER TABLE "ReviewEvent" ENABLE TRIGGER USER'
    )
  }
}

const readReviewStateDigest = async (target: ReviewCenterFixture) => {
  const wrongNote = await database.client.wrongNote.findUniqueOrThrow({
    where: { id: target.wrongNoteId }
  })
  const schedule = await database.client.reviewSchedule.findUniqueOrThrow({
    where: { wrongNoteId: target.wrongNoteId }
  })
  const events = await database.client.reviewEvent.findMany({
    where: { wrongNoteId: target.wrongNoteId },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }]
  })
  return JSON.stringify({ wrongNote, schedule, events })
}

const collectHistoryFromCursor = async (
  reviewCenterService: WrongNoteReviewCenterService,
  target: ReviewCenterFixture,
  initialCursor: string | null
) => {
  const items: ReviewEventHistoryItem[] = []
  let cursor = initialCursor
  while (cursor !== null) {
    const page = listReviewEventsResponseSchema.parse(
      await reviewCenterService.listReviewEvents(
        target.userId,
        target.questionId,
        { cursor, pageSize: 100 }
      )
    )
    items.push(...page.items)
    cursor = page.nextCursor
  }
  return items
}

const waitForBackendLock = async (backendPid: number): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await database.client.$queryRaw<{ waiting: boolean }[]>`
      SELECT (activity.wait_event_type = 'Lock') AS waiting
      FROM pg_stat_activity AS activity
      WHERE activity.pid = ${backendPid}::int
    `
    if (rows[0]?.waiting === true) {
      return
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('두 번째 memo writer의 row-lock 대기를 확인하지 못했습니다.')
}

const expectHistoryChain = (items: readonly ReviewEventHistoryItem[]): void => {
  items.forEach((event, index) => {
    const newer = items[index - 1]
    if (newer === undefined) {
      return
    }
    expect(newer.previousStatus).toBe(event.nextStatus)
    expect(newer.previousCorrectStreak).toBe(event.nextCorrectStreak)
    expect(newer.previousWrongCount).toBe(event.wrongCountAfter)
  })
}

const captureNotFound = async (
  operation: () => Promise<unknown>
): Promise<{
  readonly code: string
  readonly message: string
  readonly retryable: boolean
}> => {
  try {
    await operation()
  } catch (error: unknown) {
    if (error instanceof ApplicationError) {
      return {
        code: error.code,
        message: error.message,
        retryable: error.retryable
      }
    }
    throw error
  }
  throw new Error('owner-safe RESOURCE_NOT_FOUND가 필요합니다.')
}

beforeAll(async () => {
  await database.checkReadiness()
  const ownerUserId = await createUser('owner')
  foreignUserId = await createUser('foreign')
  fixture = await createInitialWrongNote(ownerUserId)
  await insertVersionRebaseEvents(fixture, HISTORY_CARDINALITY - 1, 0)
})

afterAll(async () => {
  if (questionRestoreState) {
    await database.client.question.update({
      where: { id: questionRestoreState.questionId },
      data: {
        lifecycleStatus: questionRestoreState.lifecycleStatus,
        archivedAt: questionRestoreState.archivedAt,
        currentPublishedVersionId:
          questionRestoreState.currentPublishedVersionId
      }
    })
  }
  if (createdUserIds.size > 0) {
    await database.client.user.deleteMany({
      where: { id: { in: [...createdUserIds] } }
    })
  }
  await database.disconnect()
})

describe.sequential('Slice 2 WrongNote review-center PostgreSQL', () => {
  it('memo normalize/no-op/update/delete와 concurrent last-commit을 review state 변경 없이 보존한다', async () => {
    const stateBefore = await readReviewStateDigest(fixture)
    const oneCodePoint = updateWrongNoteMemoBodySchema.parse({
      memo: ' 𠮷 '
    })
    const created = await service.updateMemo(
      fixture.userId,
      fixture.questionId,
      oneCodePoint
    )
    assertNoReviewCenterForbiddenKeys('MEMO', created)
    expect(created?.text).toBe('𠮷')
    expect(created?.createdAt).toBe(created?.updatedAt)

    const storedCreated = await database.client.userMemo.findUniqueOrThrow({
      where: { wrongNoteId: fixture.wrongNoteId }
    })
    const same = await service.updateMemo(
      fixture.userId,
      fixture.questionId,
      updateWrongNoteMemoBodySchema.parse({ memo: '𠮷' })
    )
    const storedSame = await database.client.userMemo.findUniqueOrThrow({
      where: { wrongNoteId: fixture.wrongNoteId }
    })
    expect(same).toEqual(created)
    expect(storedSame).toEqual(storedCreated)

    const maximumMemo = '𠮷'.repeat(2_000)
    await service.updateMemo(
      fixture.userId,
      fixture.questionId,
      updateWrongNoteMemoBodySchema.parse({ memo: maximumMemo })
    )
    expect(
      (
        await database.client.userMemo.findUniqueOrThrow({
          where: { wrongNoteId: fixture.wrongNoteId },
          select: { text: true }
        })
      ).text
    ).toBe(maximumMemo)
    expect(
      updateWrongNoteMemoBodySchema.safeParse({ memo: '𠮷'.repeat(2_001) })
        .success
    ).toBe(false)

    for (const body of [{ memo: ' \n\t ' }, { memo: null }]) {
      expect(
        await service.updateMemo(
          fixture.userId,
          fixture.questionId,
          updateWrongNoteMemoBodySchema.parse(body)
        )
      ).toBeNull()
    }
    expect(
      await database.client.userMemo.findUnique({
        where: { wrongNoteId: fixture.wrongNoteId }
      })
    ).toBeNull()

    let announceLock: (() => void) | undefined
    let releaseLock: (() => void) | undefined
    let announceSecondBackendPid: ((backendPid: number) => void) | undefined
    const locked = new Promise<void>((resolve) => {
      announceLock = resolve
    })
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const secondBackendPid = new Promise<number>((resolve) => {
      announceSecondBackendPid = resolve
    })
    const firstRepository = createPrismaWrongNoteReviewCenterRepository(
      database.client,
      {
        afterOwnedWrongNoteLocked: async () => {
          announceLock?.()
          await released
        }
      }
    )
    const secondRepository = createPrismaWrongNoteReviewCenterRepository(
      database.client,
      {
        beforeOwnedWrongNoteLock: async (backendPid) => {
          announceSecondBackendPid?.(backendPid)
        }
      }
    )
    const firstWrite = firstRepository.updateOwnedMemo({
      userId: fixture.userId,
      questionId: fixture.questionId,
      memo: 'first writer'
    })
    await locked
    const secondWrite = secondRepository.updateOwnedMemo({
      userId: fixture.userId,
      questionId: fixture.questionId,
      memo: 'second writer'
    })
    await waitForBackendLock(await secondBackendPid)
    releaseLock?.()
    const firstResult = await firstWrite
    const secondResult = await secondWrite

    if (!firstResult.found || firstResult.memo === null) {
      throw new Error('첫 번째 memo writer 결과가 필요합니다.')
    }
    if (!secondResult.found || secondResult.memo === null) {
      throw new Error('두 번째 memo writer 결과가 필요합니다.')
    }
    expect(secondResult.memo.createdAt).toEqual(firstResult.memo.createdAt)
    expect(secondResult.memo.updatedAt.getTime()).toBeGreaterThanOrEqual(
      firstResult.memo.updatedAt.getTime()
    )

    expect(
      await database.client.userMemo.findUnique({
        where: { wrongNoteId: fixture.wrongNoteId },
        select: { createdAt: true, text: true, updatedAt: true }
      })
    ).toEqual({
      createdAt: secondResult.memo.createdAt,
      text: 'second writer',
      updatedAt: secondResult.memo.updatedAt
    })
    expect(
      await database.client.userMemo.count({
        where: { wrongNoteId: fixture.wrongNoteId }
      })
    ).toBe(1)
    expect(await readReviewStateDigest(fixture)).toBe(stateBefore)
  })

  it('205-event keyset은 concurrent newest append 뒤에도 duplicate/skip 없이 archive에서 유지된다', async () => {
    const firstPage = listReviewEventsResponseSchema.parse(
      await service.listReviewEvents(fixture.userId, fixture.questionId, {
        pageSize: 100
      })
    )
    assertNoReviewCenterForbiddenKeys('HISTORY', firstPage)
    expect(firstPage.items).toHaveLength(100)
    expect(firstPage.nextCursor).not.toBeNull()
    const initialIds = (
      await database.client.reviewEvent.findMany({
        where: { wrongNoteId: fixture.wrongNoteId },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { id: true }
      })
    ).map(({ id }) => id)
    expect(initialIds).toHaveLength(HISTORY_CARDINALITY)

    await insertVersionRebaseEvents(fixture, 1, 300)
    const continuation = await collectHistoryFromCursor(
      service,
      fixture,
      firstPage.nextCursor
    )
    const oldCursorIds = [
      ...firstPage.items.map(({ id }) => id),
      ...continuation.map(({ id }) => id)
    ]
    const oldCursorItems = [...firstPage.items, ...continuation]
    expect(oldCursorIds).toEqual(initialIds)
    expect(new Set(oldCursorIds).size).toBe(HISTORY_CARDINALITY)
    const boundaryNewer = firstPage.items.at(-1)
    const boundaryOlder = continuation[0]
    if (!boundaryNewer || !boundaryOlder) {
      throw new Error('동일 occurredAt cursor 경계 event가 필요합니다.')
    }
    expect(boundaryNewer.occurredAt).toBe(boundaryOlder.occurredAt)
    expect(boundaryNewer.id > boundaryOlder.id).toBe(true)
    expectHistoryChain(oldCursorItems)
    expect(oldCursorItems.at(-1)).toMatchObject({
      source: 'STUDY_SUBMIT',
      questionVersionId: fixture.questionVersionId,
      selectedOptionId: null,
      isCorrect: false,
      elapsedSec: 9,
      previousStatus: null,
      nextStatus: 'NEW',
      wrongCountAfter: 1
    })

    const refreshedFirstPage = listReviewEventsResponseSchema.parse(
      await service.listReviewEvents(fixture.userId, fixture.questionId, {
        pageSize: 100
      })
    )
    expect(refreshedFirstPage.items).toHaveLength(100)
    expect(refreshedFirstPage.items[0]?.id).not.toBe(initialIds[0])
    assertNoReviewCenterForbiddenKeys('HISTORY', refreshedFirstPage)
    const refreshedContinuation = await collectHistoryFromCursor(
      service,
      fixture,
      refreshedFirstPage.nextCursor
    )
    const refreshedItems = [
      ...refreshedFirstPage.items,
      ...refreshedContinuation
    ]
    const refreshedIds = refreshedItems.map(({ id }) => id)
    expect(refreshedIds).toHaveLength(HISTORY_CARDINALITY + 1)
    expect(new Set(refreshedIds).size).toBe(HISTORY_CARDINALITY + 1)
    expectHistoryChain(refreshedItems)
    expect(
      refreshedItems.every(
        ({ questionVersionId }) =>
          questionVersionId === fixture.questionVersionId
      )
    ).toBe(true)

    const originalQuestion = await database.client.question.findUniqueOrThrow({
      where: { id: fixture.questionId },
      select: {
        id: true,
        lifecycleStatus: true,
        archivedAt: true,
        currentPublishedVersionId: true
      }
    })
    questionRestoreState = {
      questionId: originalQuestion.id,
      lifecycleStatus: originalQuestion.lifecycleStatus,
      archivedAt: originalQuestion.archivedAt,
      currentPublishedVersionId: originalQuestion.currentPublishedVersionId
    }
    await database.client.question.update({
      where: { id: fixture.questionId },
      data: {
        lifecycleStatus: 'ARCHIVED',
        archivedAt: new Date('2026-08-22T01:00:00.000Z'),
        currentPublishedVersionId: null
      }
    })

    const archivedMemo = await service.getMemo(
      fixture.userId,
      fixture.questionId
    )
    const archivedFirstPage = listReviewEventsResponseSchema.parse(
      await service.listReviewEvents(fixture.userId, fixture.questionId, {
        pageSize: 100
      })
    )
    const archivedContinuation = await collectHistoryFromCursor(
      service,
      fixture,
      archivedFirstPage.nextCursor
    )
    const archivedItems = [...archivedFirstPage.items, ...archivedContinuation]
    expect(archivedMemo?.text).toBe('second writer')
    expect(archivedItems.map(({ id }) => id)).toEqual(refreshedIds)
    expect(
      archivedItems.every(
        ({ questionVersionId }) =>
          questionVersionId === fixture.questionVersionId
      )
    ).toBe(true)
    assertNoReviewCenterForbiddenKeys('HISTORY', {
      items: archivedItems.slice(0, 100),
      nextCursor: archivedFirstPage.nextCursor
    })

    const memoBeforeUnauthorizedWrites =
      await database.client.userMemo.findUniqueOrThrow({
        where: { wrongNoteId: fixture.wrongNoteId }
      })
    const failures: {
      readonly code: string
      readonly message: string
      readonly retryable: boolean
    }[] = []
    for (const [userId, questionId] of [
      [foreignUserId, fixture.questionId],
      [fixture.userId, randomUUID()]
    ] as const) {
      failures.push(
        await captureNotFound(() => service.getMemo(userId, questionId)),
        await captureNotFound(() =>
          service.updateMemo(
            userId,
            questionId,
            updateWrongNoteMemoBodySchema.parse({ memo: 'unauthorized' })
          )
        ),
        await captureNotFound(() =>
          service.listReviewEvents(userId, questionId, { pageSize: 1 })
        )
      )
    }
    failures.forEach((failure) =>
      expect(failure).toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: '오답 노트를 찾을 수 없습니다.',
        retryable: false
      })
    )
    expect(
      await database.client.userMemo.findUniqueOrThrow({
        where: { wrongNoteId: fixture.wrongNoteId }
      })
    ).toEqual(memoBeforeUnauthorizedWrites)
    expect(failures).toHaveLength(6)
    expect(
      new Set(failures.map((failure) => JSON.stringify(failure))).size
    ).toBe(1)
    expect(archivedItems.at(-1)).toMatchObject({
      source: 'STUDY_SUBMIT',
      elapsedSec: 9,
      questionVersionId: fixture.questionVersionId
    })
    expect(archivedItems).toHaveLength(HISTORY_CARDINALITY + 1)
    expect(archivedFirstPage.items).toHaveLength(100)
    expect(archivedFirstPage.nextCursor).not.toBeNull()
  })
})

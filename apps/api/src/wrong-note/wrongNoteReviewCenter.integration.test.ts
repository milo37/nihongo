import { randomUUID } from 'node:crypto'
import {
  createStudySessionV2BodySchema,
  createStudySessionV2ResponseSchema
} from '@nihongo/contracts/study/create-study-session'
import {
  listReviewEventsResponseSchema,
  type ReviewEventHistoryItem
} from '@nihongo/contracts/wrong-note/list-review-events'
import {
  listReviewQueueQuerySchema,
  listReviewQueueResponseSchema
} from '@nihongo/contracts/wrong-note/list-review-queue'
import { updateWrongNoteMemoBodySchema } from '@nihongo/contracts/wrong-note/update-wrong-note-memo'
import { assertNoReviewCenterForbiddenKeys } from '@nihongo/contracts/testing/review-center-conformance'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { getPostgresSchema } from '../db/databaseOptions.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { ApplicationError } from '../errors/applicationError.js'
import { createPrismaStudySessionRepository } from '../study/studySessionRepository.js'
import { createStudySessionService } from '../study/studySessionService.js'
import { createPrismaWrongNoteReviewCenterRepository } from './wrongNoteReviewCenterRepository.js'
import {
  createWrongNoteReviewCenterService,
  type WrongNoteReviewCenterService
} from './wrongNoteReviewCenterService.js'
import { createPrismaWrongNoteReviewQueueRepository } from './wrongNoteReviewQueueRepository.js'
import { createWrongNoteReviewQueueService } from './wrongNoteReviewQueueService.js'
import { createPrismaWrongNoteTargetedReviewRepository } from './wrongNoteTargetedReviewRepository.js'
import { createWrongNoteTargetedReviewService } from './wrongNoteTargetedReviewService.js'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000
const SUBMITTED_AT = new Date('2026-08-22T00:00:00.000Z')
const TARGETED_AT = new Date('2026-08-22T12:00:00.000Z')
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

const setQueueFixtureState = async (
  target: ReviewCenterFixture,
  state:
    | { readonly kind: 'NEW' }
    | { readonly kind: 'AGAIN'; readonly occurredAt: Date }
    | { readonly kind: 'SOLVED'; readonly occurredAt: Date }
): Promise<void> => {
  for (const tableName of ['WrongNote', 'ReviewSchedule']) {
    await database.client.$executeRawUnsafe(
      `ALTER TABLE "${tableName}" DISABLE TRIGGER USER`
    )
  }
  try {
    if (state.kind === 'NEW') {
      await database.client.wrongNote.update({
        where: { id: target.wrongNoteId },
        data: {
          status: 'NEW',
          wrongCount: 1,
          correctStreak: 0,
          lastWrongAt: SUBMITTED_AT,
          lastReviewedAt: null,
          updatedAt: SUBMITTED_AT
        }
      })
      await database.client.reviewSchedule.update({
        where: { wrongNoteId: target.wrongNoteId },
        data: {
          nextReviewAt: new Date(SUBMITTED_AT.getTime() + DAY_MILLISECONDS),
          intervalDays: 1,
          algorithmVersion: 1,
          updatedAt: SUBMITTED_AT
        }
      })
      return
    }

    await database.client.wrongNote.update({
      where: { id: target.wrongNoteId },
      data: {
        status: state.kind,
        wrongCount: 2,
        correctStreak: state.kind === 'SOLVED' ? 2 : 0,
        lastWrongAt: state.kind === 'SOLVED' ? SUBMITTED_AT : state.occurredAt,
        lastReviewedAt: state.occurredAt,
        updatedAt: state.occurredAt
      }
    })
    await database.client.reviewSchedule.update({
      where: { wrongNoteId: target.wrongNoteId },
      data: {
        nextReviewAt: new Date(
          state.occurredAt.getTime() +
            (state.kind === 'SOLVED' ? 7 : 1) * DAY_MILLISECONDS
        ),
        intervalDays: state.kind === 'SOLVED' ? 7 : 1,
        algorithmVersion: 1,
        updatedAt: state.occurredAt
      }
    })
  } finally {
    for (const tableName of ['ReviewSchedule', 'WrongNote']) {
      await database.client.$executeRawUnsafe(
        `ALTER TABLE "${tableName}" ENABLE TRIGGER USER`
      )
    }
  }
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

const captureApplicationFailure = async (
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
  throw new Error('closed ApplicationError가 필요합니다.')
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
  it('fixed snapshot queue와 filtered DAILY가 due 경계에서 같은 current question 순서를 고정한다', async () => {
    const dueAt = new Date(SUBMITTED_AT.getTime() + DAY_MILLISECONDS)
    const queueQuery = listReviewQueueQuerySchema.parse({
      view: 'DUE',
      level: 'N5',
      subject: 'VOCABULARY',
      sort: 'NEXT_REVIEW',
      page: 1,
      pageSize: 100
    })
    const futureQueueService = createWrongNoteReviewQueueService(
      createPrismaWrongNoteReviewQueueRepository(database.client),
      () => SUBMITTED_AT
    )
    const beforeDue = listReviewQueueResponseSchema.parse(
      await futureQueueService.listReviewQueue(fixture.userId, queueQuery)
    )
    expect(beforeDue).toMatchObject({
      items: [],
      total: 0,
      counts: { due: 0, unreviewed: 1, repeated: 0, solved: 0 },
      observedAt: SUBMITTED_AT.toISOString()
    })

    const queueService = createWrongNoteReviewQueueService(
      createPrismaWrongNoteReviewQueueRepository(database.client),
      () => dueAt
    )
    const due = listReviewQueueResponseSchema.parse(
      await queueService.listReviewQueue(fixture.userId, queueQuery)
    )
    assertNoReviewCenterForbiddenKeys('QUEUE', due)
    expect(due).toMatchObject({
      total: 1,
      counts: { due: 1, unreviewed: 1, repeated: 0, solved: 0 },
      observedAt: dueAt.toISOString()
    })
    expect(due.items).toHaveLength(1)
    const queueItem = due.items[0]
    if (!queueItem) {
      throw new Error('due review queue item이 필요합니다.')
    }
    expect(queueItem).toMatchObject({
      questionId: fixture.questionId,
      currentQuestionVersionId: fixture.questionVersionId,
      status: 'NEW',
      nextReviewAt: dueAt.toISOString(),
      hasMemo: false
    })

    const beyondLast = listReviewQueueResponseSchema.parse(
      await queueService.listReviewQueue(
        fixture.userId,
        listReviewQueueQuerySchema.parse({
          ...queueQuery,
          page: Number.MAX_SAFE_INTEGER
        })
      )
    )
    expect(beyondLast).toMatchObject({ items: [], total: 1 })

    let mutationCount = 0
    const snapshotRepository = createPrismaWrongNoteReviewQueueRepository(
      database.client,
      {
        afterCountsLoaded: async () => {
          mutationCount += 1
          await database.client.userMemo.create({
            data: {
              id: randomUUID(),
              wrongNoteId: fixture.wrongNoteId,
              text: 'snapshot writer',
              createdAt: dueAt,
              updatedAt: dueAt
            }
          })
        }
      }
    )
    const snapshotQueueService = createWrongNoteReviewQueueService(
      snapshotRepository,
      () => dueAt
    )
    const sameSnapshot = listReviewQueueResponseSchema.parse(
      await snapshotQueueService.listReviewQueue(fixture.userId, queueQuery)
    )
    expect(mutationCount).toBe(1)
    expect(sameSnapshot.items[0]?.hasMemo).toBe(false)
    const refreshed = listReviewQueueResponseSchema.parse(
      await queueService.listReviewQueue(fixture.userId, queueQuery)
    )
    expect(refreshed.items[0]?.hasMemo).toBe(true)
    await database.client.userMemo.delete({
      where: { wrongNoteId: fixture.wrongNoteId }
    })

    const originalQuestion = await database.client.question.findUniqueOrThrow({
      where: { id: fixture.questionId },
      select: {
        lifecycleStatus: true,
        archivedAt: true,
        currentPublishedVersionId: true
      }
    })
    try {
      const unreviewed = listReviewQueueResponseSchema.parse(
        await queueService.listReviewQueue(
          fixture.userId,
          listReviewQueueQuerySchema.parse({
            ...queueQuery,
            view: 'UNREVIEWED'
          })
        )
      )
      expect(unreviewed).toMatchObject({ total: 1 })

      await setQueueFixtureState(fixture, {
        kind: 'AGAIN',
        occurredAt: dueAt
      })
      const repeatedQueueService = createWrongNoteReviewQueueService(
        createPrismaWrongNoteReviewQueueRepository(database.client),
        () => new Date(dueAt.getTime() + DAY_MILLISECONDS)
      )
      const repeated = listReviewQueueResponseSchema.parse(
        await repeatedQueueService.listReviewQueue(
          fixture.userId,
          listReviewQueueQuerySchema.parse({
            ...queueQuery,
            view: 'REPEATED'
          })
        )
      )
      expect(repeated).toMatchObject({
        total: 1,
        counts: { due: 1, unreviewed: 0, repeated: 1, solved: 0 },
        items: [{ status: 'AGAIN' }]
      })

      await setQueueFixtureState(fixture, {
        kind: 'SOLVED',
        occurredAt: dueAt
      })
      const solvedQueueService = createWrongNoteReviewQueueService(
        createPrismaWrongNoteReviewQueueRepository(database.client),
        () => new Date(dueAt.getTime() + 7 * DAY_MILLISECONDS)
      )
      const dueSolved = listReviewQueueResponseSchema.parse(
        await solvedQueueService.listReviewQueue(fixture.userId, queueQuery)
      )
      const solved = listReviewQueueResponseSchema.parse(
        await solvedQueueService.listReviewQueue(
          fixture.userId,
          listReviewQueueQuerySchema.parse({
            ...queueQuery,
            view: 'SOLVED'
          })
        )
      )
      expect(dueSolved).toMatchObject({
        total: 1,
        counts: { due: 1, unreviewed: 0, repeated: 1, solved: 1 },
        items: [{ status: 'SOLVED' }]
      })
      expect(solved).toMatchObject({ total: 1, items: [{ status: 'SOLVED' }] })

      await database.client.question.update({
        where: { id: fixture.questionId },
        data: {
          lifecycleStatus: 'ARCHIVED',
          archivedAt: new Date(dueAt.getTime() + 1_000),
          currentPublishedVersionId: null
        }
      })
      const archived = listReviewQueueResponseSchema.parse(
        await solvedQueueService.listReviewQueue(fixture.userId, queueQuery)
      )
      expect(archived).toMatchObject({
        items: [],
        total: 0,
        counts: { due: 0, unreviewed: 0, repeated: 0, solved: 0 }
      })
    } finally {
      await database.client.question.update({
        where: { id: fixture.questionId },
        data: originalQuestion
      })
      await setQueueFixtureState(fixture, { kind: 'NEW' })
    }

    const rollbackMarker = new Error('ROLLBACK_CURRENT_VERSION_PARITY')
    await expect(
      database.client.$transaction(
        async (transaction) => {
          const historicalVersion =
            await transaction.questionVersion.findUniqueOrThrow({
              where: { id: fixture.questionVersionId },
              include: {
                options: { orderBy: { ordinal: 'asc' } },
                tags: true
              }
            })
          const historicalTag = historicalVersion.tags[0]?.labelSnapshot
          const correctOrdinal = historicalVersion.options.find(
            ({ id }) => id === historicalVersion.correctOptionId
          )?.ordinal
          if (!historicalTag || correctOrdinal === undefined) {
            throw new Error(
              'current-version parity fixture의 historical pin이 필요합니다.'
            )
          }
          const currentVersionId = randomUUID()
          const currentTagId = randomUUID()
          const currentTag = `현재판-${randomUUID().slice(0, 8)}`
          const currentPreview = `현재 공개 버전 ${randomUUID().slice(0, 8)}`
          const nextVersionNumber =
            (
              await transaction.questionVersion.aggregate({
                where: { questionId: fixture.questionId },
                _max: { versionNumber: true }
              })
            )._max.versionNumber ?? 0
          const currentOptions = historicalVersion.options.map((option) => ({
            id: randomUUID(),
            questionVersionId: currentVersionId,
            label: option.label,
            ordinal: option.ordinal,
            text: option.text
          }))
          const currentCorrectOptionId = currentOptions.find(
            ({ ordinal }) => ordinal === correctOrdinal
          )?.id
          if (!currentCorrectOptionId) {
            throw new Error(
              'current-version parity fixture의 정답 pin이 필요합니다.'
            )
          }

          await transaction.questionVersion.create({
            data: {
              id: currentVersionId,
              questionId: fixture.questionId,
              versionNumber: nextVersionNumber + 1,
              level: historicalVersion.level,
              subject: historicalVersion.subject,
              questionType: historicalVersion.questionType,
              passage: historicalVersion.passage,
              questionText: currentPreview,
              explanationKo: historicalVersion.explanationKo,
              explanationJa: historicalVersion.explanationJa,
              difficulty: historicalVersion.difficulty,
              sourceType: historicalVersion.sourceType,
              createdByLabelSnapshot: historicalVersion.createdByLabelSnapshot
            }
          })
          await transaction.questionOption.createMany({ data: currentOptions })
          await transaction.tag.create({
            data: {
              id: currentTagId,
              label: currentTag,
              normalizedName: `phase5-current-${randomUUID()}`
            }
          })
          await transaction.questionVersionTag.create({
            data: {
              id: randomUUID(),
              questionVersionId: currentVersionId,
              tagId: currentTagId,
              labelSnapshot: currentTag
            }
          })
          await transaction.questionVersion.update({
            where: { id: currentVersionId },
            data: {
              correctOptionId: currentCorrectOptionId,
              status: 'PUBLISHED',
              publishedAt: dueAt
            }
          })
          await transaction.question.update({
            where: { id: fixture.questionId },
            data: { currentPublishedVersionId: currentVersionId }
          })

          const queueTransaction = {
            $executeRaw: async () => 0,
            $queryRaw: transaction.$queryRaw.bind(transaction)
          } as unknown as typeof transaction
          const queueClient = {
            $transaction: async <Result>(
              operation: (client: typeof transaction) => Promise<Result>
            ): Promise<Result> => await operation(queueTransaction)
          } as unknown as typeof database.client
          const studyClient = {
            $transaction: async <Result>(
              operation: (client: typeof transaction) => Promise<Result>
            ): Promise<Result> => await operation(transaction)
          } as unknown as typeof database.client
          const currentQueueService = createWrongNoteReviewQueueService(
            createPrismaWrongNoteReviewQueueRepository(queueClient),
            () => dueAt
          )
          const currentQueue = listReviewQueueResponseSchema.parse(
            await currentQueueService.listReviewQueue(
              fixture.userId,
              queueQuery
            )
          )
          expect(currentQueue.items).toEqual([
            expect.objectContaining({
              questionId: fixture.questionId,
              currentQuestionVersionId: currentVersionId,
              questionPreview: currentPreview,
              tags: [currentTag]
            })
          ])
          expect(
            await transaction.wrongNote.findUniqueOrThrow({
              where: { id: fixture.wrongNoteId },
              select: { lastWrongQuestionVersionId: true }
            })
          ).toEqual({ lastWrongQuestionVersionId: fixture.questionVersionId })

          const oldTagQueue = listReviewQueueResponseSchema.parse(
            await currentQueueService.listReviewQueue(
              fixture.userId,
              listReviewQueueQuerySchema.parse({
                ...queueQuery,
                questionType: historicalVersion.questionType,
                tag: historicalTag
              })
            )
          )
          expect(oldTagQueue).toMatchObject({ total: 0, items: [] })

          const filteredQuery = listReviewQueueQuerySchema.parse({
            ...queueQuery,
            questionType: historicalVersion.questionType,
            tag: currentTag
          })
          const filteredQueue = listReviewQueueResponseSchema.parse(
            await currentQueueService.listReviewQueue(
              fixture.userId,
              filteredQuery
            )
          )
          const studyService = createStudySessionService(
            createPrismaStudySessionRepository(studyClient, {
              delay: async () => undefined,
              jitterMilliseconds: () => 0,
              random: () => 0
            }),
            () => dueAt
          )

          for (const mode of ['DAILY_REVIEW', 'WRONG_NOTE'] as const) {
            const created = await studyService.create(
              createStudySessionV2BodySchema.parse({
                level: 'N5',
                subject: 'VOCABULARY',
                mode,
                count: 20,
                reviewFilter: {
                  questionType: historicalVersion.questionType,
                  tag: currentTag
                }
              }),
              { kind: 'USER', userId: fixture.userId },
              2
            )
            const session = createStudySessionV2ResponseSchema.parse(
              created.payload
            )
            expect(session.session).toMatchObject({
              mode,
              actualCount: filteredQueue.total,
              usedFallback: false,
              fallbackReason: null
            })
            expect(
              session.questions.map(({ question }) => ({
                questionId: question.id,
                questionVersionId: question.questionVersionId
              }))
            ).toEqual([
              {
                questionId: fixture.questionId,
                questionVersionId: currentVersionId
              }
            ])
          }
          throw rollbackMarker
        },
        { timeout: 20_000 }
      )
    ).rejects.toBe(rollbackMarker)
  })

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

describe.sequential('Slice 4 targeted review PostgreSQL', () => {
  it('same-key winner/replay를 단일 targeted aggregate로 만든다', async () => {
    const userId = await createUser('targeted-owner')
    const targetFixture = await createInitialWrongNote(userId)
    let announceReservation: (() => void) | undefined
    let announceContenderQuestionLock: (() => void) | undefined
    let releaseWinner: (() => void) | undefined
    const reservationCreated = new Promise<void>((resolve) => {
      announceReservation = resolve
    })
    const contenderQuestionLocked = new Promise<void>((resolve) => {
      announceContenderQuestionLock = resolve
    })
    const winnerReleased = new Promise<void>((resolve) => {
      releaseWinner = resolve
    })
    const targetService = createWrongNoteTargetedReviewService(
      createPrismaWrongNoteTargetedReviewRepository(database.client, {
        afterReservation: async () => {
          announceReservation?.()
          await winnerReleased
        },
        delay: async () => undefined,
        jitterMilliseconds: () => 0
      }),
      () => new Date(TARGETED_AT)
    )
    const pointerBefore = await database.client.wrongNote.findUniqueOrThrow({
      where: { id: targetFixture.wrongNoteId },
      select: { currentReviewQuestionVersionId: true, updatedAt: true }
    })
    const idempotencyKey = randomUUID()

    const outcomes = await (async () => {
      const contenderDatabase = createDatabaseRuntime(environment.DATABASE_URL)
      const contenderService = createWrongNoteTargetedReviewService(
        createPrismaWrongNoteTargetedReviewRepository(
          contenderDatabase.client,
          {
            afterQuestionLocked: async () => {
              announceContenderQuestionLock?.()
            },
            delay: async () => undefined,
            jitterMilliseconds: () => 0
          }
        ),
        () => new Date(TARGETED_AT)
      )
      try {
        const winner = targetService.createTargetedReviewSession(
          userId,
          targetFixture.questionId,
          idempotencyKey
        )
        await reservationCreated
        const contender = contenderService.createTargetedReviewSession(
          userId,
          targetFixture.questionId,
          idempotencyKey
        )
        await contenderQuestionLocked
        releaseWinner?.()
        return await Promise.all([winner, contender])
      } finally {
        releaseWinner?.()
        await contenderDatabase.disconnect()
      }
    })()
    expect(outcomes.map(({ replayed }) => replayed).toSorted()).toEqual([
      false,
      true
    ])
    expect(outcomes[0]?.response).toEqual(outcomes[1]?.response)
    const created = outcomes[0]?.response
    if (!created) {
      throw new Error('targeted review response가 필요합니다.')
    }
    assertNoReviewCenterForbiddenKeys('TARGETED_SESSION', created)
    expect(created.session).toMatchObject({
      mode: 'WRONG_NOTE',
      status: 'IN_PROGRESS',
      requestedCount: 1,
      actualCount: 1,
      usedFallback: false,
      fallbackReason: null,
      practiceContractVersion: 2
    })
    expect(created.questions).toHaveLength(1)
    expect(created.questions[0]?.question).toMatchObject({
      id: targetFixture.questionId,
      questionVersionId: targetFixture.questionVersionId
    })

    const aggregate = await database.client.studySession.findUniqueOrThrow({
      where: { id: created.session.id },
      include: { questions: true, draft: { include: { answers: true } } }
    })
    expect(aggregate.questions).toHaveLength(1)
    expect(aggregate.draft).toMatchObject({
      revision: 0,
      currentOrdinal: 1,
      savedAt: null
    })
    expect(aggregate.draft?.answers).toHaveLength(1)
    expect(
      await database.client.studySession.count({
        where: {
          userId,
          mode: 'WRONG_NOTE',
          practiceContractVersion: 2
        }
      })
    ).toBe(1)
    expect(
      await database.client.idempotencyRecord.count({
        where: {
          userId,
          operation: 'STUDY_TARGETED_REVIEW_CREATE',
          idempotencyKey
        }
      })
    ).toBe(1)
    expect(
      await database.client.reviewEvent.count({
        where: { studySessionId: created.session.id }
      })
    ).toBe(0)
    expect(
      await database.client.studyAnswer.count({
        where: { studySessionQuestion: { studySessionId: created.session.id } }
      })
    ).toBe(0)
    expect(
      await database.client.studyResult.count({
        where: { studySessionId: created.session.id }
      })
    ).toBe(0)
    expect(
      await database.client.wrongNote.findUniqueOrThrow({
        where: { id: targetFixture.wrongNoteId },
        select: { currentReviewQuestionVersionId: true, updatedAt: true }
      })
    ).toEqual({
      currentReviewQuestionVersionId: targetFixture.questionVersionId,
      updatedAt: pointerBefore.updatedAt
    })

    await expect(
      targetService.createTargetedReviewSession(
        userId,
        randomUUID(),
        idempotencyKey
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })

    const questionBeforeArchive =
      await database.client.question.findUniqueOrThrow({
        where: { id: targetFixture.questionId },
        select: {
          archivedAt: true,
          currentPublishedVersionId: true,
          lifecycleStatus: true,
          updatedAt: true
        }
      })
    try {
      await database.client.question.update({
        where: { id: targetFixture.questionId },
        data: {
          lifecycleStatus: 'ARCHIVED',
          archivedAt: new Date(TARGETED_AT.getTime() + 2_000),
          currentPublishedVersionId: null
        }
      })
      await expect(
        targetService.createTargetedReviewSession(
          userId,
          targetFixture.questionId,
          idempotencyKey
        )
      ).resolves.toEqual({ replayed: true, response: created })
      await expect(
        targetService.createTargetedReviewSession(
          userId,
          targetFixture.questionId,
          randomUUID()
        )
      ).rejects.toMatchObject({ code: 'QUESTION_NOT_AVAILABLE' })
    } finally {
      await database.client.question.update({
        where: { id: targetFixture.questionId },
        data: questionBeforeArchive
      })
    }
  })

  it('current-version share lock 뒤 archive를 직렬화하고 pinned historical replay를 보존한다', async () => {
    const userId = await createUser('targeted-lock')
    const targetFixture = await createInitialWrongNote(userId)
    const schema = getPostgresSchema(environment.DATABASE_URL)
    const archiveClient = new Client({
      connectionString: environment.DATABASE_URL,
      ...(schema ? { options: `-c search_path=${schema}` } : {})
    })
    let announceQuestionLock: (() => void) | undefined
    let releaseQuestionLock: (() => void) | undefined
    const questionLocked = new Promise<void>((resolve) => {
      announceQuestionLock = resolve
    })
    const questionReleased = new Promise<void>((resolve) => {
      releaseQuestionLock = resolve
    })
    const targetService = createWrongNoteTargetedReviewService(
      createPrismaWrongNoteTargetedReviewRepository(database.client, {
        afterQuestionLocked: async () => {
          announceQuestionLock?.()
          await questionReleased
        },
        delay: async () => undefined,
        jitterMilliseconds: () => 0
      }),
      () => new Date(TARGETED_AT)
    )
    const originalQuestion = await database.client.question.findUniqueOrThrow({
      where: { id: targetFixture.questionId },
      select: {
        archivedAt: true,
        currentPublishedVersionId: true,
        lifecycleStatus: true,
        updatedAt: true
      }
    })
    const idempotencyKey = randomUUID()
    let createPromise:
      | ReturnType<typeof targetService.createTargetedReviewSession>
      | undefined
    let archiveUpdate: Promise<unknown> | undefined
    let archiveTransactionOpen = false
    let archiveCommitted = false

    try {
      await archiveClient.connect()
      createPromise = targetService.createTargetedReviewSession(
        userId,
        targetFixture.questionId,
        idempotencyKey
      )
      await Promise.race([
        questionLocked,
        createPromise.then(() => {
          throw new Error(
            'targeted create가 current-version lock hook을 건너뛰었습니다.'
          )
        })
      ])
      const backend = await archiveClient.query<{ processId: number }>(
        'SELECT pg_backend_pid() AS "processId"'
      )
      const processId = backend.rows[0]?.processId
      if (processId === undefined) {
        throw new Error('targeted archive backend PID가 필요합니다.')
      }
      await archiveClient.query('BEGIN')
      archiveTransactionOpen = true
      let archiveSettled = false
      archiveUpdate = archiveClient
        .query(
          `UPDATE "Question"
           SET "lifecycleStatus" = 'ARCHIVED',
               "archivedAt" = $2,
               "currentPublishedVersionId" = NULL,
               "updatedAt" = $2
           WHERE "id" = $1`,
          [targetFixture.questionId, new Date(TARGETED_AT.getTime() + 1_000)]
        )
        .finally(() => {
          archiveSettled = true
        })
      await waitForBackendLock(processId)
      expect(archiveSettled).toBe(false)
      releaseQuestionLock?.()

      const created = await createPromise
      await archiveUpdate
      await archiveClient.query('COMMIT')
      archiveTransactionOpen = false
      archiveCommitted = true
      expect(created.response.questions[0]?.question).toMatchObject({
        id: targetFixture.questionId,
        questionVersionId: targetFixture.questionVersionId
      })
      expect(
        await database.client.question.findUniqueOrThrow({
          where: { id: targetFixture.questionId },
          select: { lifecycleStatus: true, currentPublishedVersionId: true }
        })
      ).toEqual({
        lifecycleStatus: 'ARCHIVED',
        currentPublishedVersionId: null
      })
      await expect(
        targetService.createTargetedReviewSession(
          userId,
          targetFixture.questionId,
          idempotencyKey
        )
      ).resolves.toEqual({ replayed: true, response: created.response })
      await expect(
        targetService.createTargetedReviewSession(
          userId,
          targetFixture.questionId,
          randomUUID()
        )
      ).rejects.toMatchObject({ code: 'QUESTION_NOT_AVAILABLE' })
    } finally {
      releaseQuestionLock?.()
      await createPromise?.catch(() => undefined)
      await archiveUpdate?.catch(() => undefined)
      if (archiveTransactionOpen) {
        await archiveClient.query('ROLLBACK').catch(() => undefined)
      }
      if (archiveCommitted) {
        await database.client.question.update({
          where: { id: targetFixture.questionId },
          data: originalQuestion
        })
      }
      await archiveClient.end().catch(() => undefined)
    }
  }, 15_000)

  it('foreign/missing 404를 구분하지 않고 pointer 이후 실패를 전부 rollback한다', async () => {
    const userId = await createUser('targeted-rollback')
    const foreignId = await createUser('targeted-foreign')
    const targetFixture = await createInitialWrongNote(userId)
    const normalService = createWrongNoteTargetedReviewService(
      createPrismaWrongNoteTargetedReviewRepository(database.client),
      () => new Date(TARGETED_AT)
    )
    const failures = [
      await captureApplicationFailure(() =>
        normalService.createTargetedReviewSession(
          foreignId,
          targetFixture.questionId,
          randomUUID()
        )
      ),
      await captureApplicationFailure(() =>
        normalService.createTargetedReviewSession(
          userId,
          randomUUID(),
          randomUUID()
        )
      )
    ]
    expect(
      new Set(failures.map((failure) => JSON.stringify(failure))).size
    ).toBe(1)
    expect(failures[0]).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      message: '복습할 오답 노트를 찾을 수 없습니다.',
      retryable: false
    })

    const pointerBefore = await database.client.wrongNote.findUniqueOrThrow({
      where: { id: targetFixture.wrongNoteId },
      select: { currentReviewQuestionVersionId: true, updatedAt: true }
    })
    const countsBefore = {
      drafts: await database.client.studyDraft.count({
        where: { studySession: { userId } }
      }),
      idempotency: await database.client.idempotencyRecord.count({
        where: { userId, operation: 'STUDY_TARGETED_REVIEW_CREATE' }
      }),
      questions: await database.client.studySessionQuestion.count({
        where: { studySession: { userId, practiceContractVersion: 2 } }
      }),
      sessions: await database.client.studySession.count({
        where: { userId, practiceContractVersion: 2 }
      })
    }
    const rollbackMarker = new Error('slice4-after-pointer-rollback')
    const rollbackKey = randomUUID()
    const failingRepository = createPrismaWrongNoteTargetedReviewRepository(
      database.client,
      {
        afterPointerUpdated: async () => {
          throw rollbackMarker
        }
      }
    )
    await expect(
      failingRepository.createAtomic({
        userId,
        questionId: targetFixture.questionId,
        idempotencyKey: rollbackKey,
        observedAt: new Date(TARGETED_AT)
      })
    ).rejects.toBe(rollbackMarker)
    expect(
      await database.client.wrongNote.findUniqueOrThrow({
        where: { id: targetFixture.wrongNoteId },
        select: { currentReviewQuestionVersionId: true, updatedAt: true }
      })
    ).toEqual(pointerBefore)
    await expect(
      Promise.resolve({
        drafts: await database.client.studyDraft.count({
          where: { studySession: { userId } }
        }),
        idempotency: await database.client.idempotencyRecord.count({
          where: { userId, operation: 'STUDY_TARGETED_REVIEW_CREATE' }
        }),
        questions: await database.client.studySessionQuestion.count({
          where: { studySession: { userId, practiceContractVersion: 2 } }
        }),
        sessions: await database.client.studySession.count({
          where: { userId, practiceContractVersion: 2 }
        })
      })
    ).resolves.toEqual(countsBefore)
    await expect(
      normalService.createTargetedReviewSession(
        userId,
        targetFixture.questionId,
        rollbackKey
      )
    ).resolves.toMatchObject({ replayed: false })
  })
})

import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { getPostgresSchema } from '../db/databaseOptions.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { createPrismaStudySessionRepository } from '../study/studySessionRepository.js'
import { createStudySessionService } from '../study/studySessionService.js'
import { createPrismaBookmarkRepository } from './bookmarkRepository.js'
import { createBookmarkService } from './bookmarkService.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
const repository = createPrismaBookmarkRepository(database.client)
const bookmarkService = createBookmarkService(repository)
const studySessionRepository = createPrismaStudySessionRepository(
  database.client
)
const createdUserIds = new Set<string>()

interface PublishedQuestionFixture {
  id: string
  questionVersionId: string
}

const createUser = async (label: string): Promise<string> => {
  const user = await database.client.user.create({
    data: {
      email: `slice4-bookmark-${label}-${randomUUID()}@example.test`,
      emailVerified: true,
      name: `Slice 4 ${label}`
    },
    select: { id: true }
  })
  createdUserIds.add(user.id)
  return user.id
}

const readPublishedQuestions = async (): Promise<PublishedQuestionFixture[]> =>
  await database.client.question
    .findMany({
      where: {
        lifecycleStatus: 'ACTIVE',
        currentPublishedVersion: {
          is: {
            status: 'PUBLISHED',
            level: 'N5',
            subject: 'VOCABULARY'
          }
        }
      },
      orderBy: { id: 'asc' },
      take: 3,
      select: { id: true, currentPublishedVersionId: true }
    })
    .then((questions) =>
      questions.map(({ id, currentPublishedVersionId }) => {
        if (!currentPublishedVersionId) {
          throw new Error(
            'Bookmark integration published version이 필요합니다.'
          )
        }
        return { id, questionVersionId: currentPublishedVersionId }
      })
    )

const collectKeys = (value: unknown, keys: Set<string>): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys))
    return
  }
  if (!value || typeof value !== 'object') return
  Object.entries(value).forEach(([key, nested]) => {
    keys.add(key)
    collectKeys(nested, keys)
  })
}

const waitForPostgresLockWait = async (
  observer: Client,
  processId: number
): Promise<void> => {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const activity = await observer.query<{
      state: string
      waitEventType: string | null
    }>(
      `SELECT
         state,
         wait_event_type AS "waitEventType"
       FROM pg_stat_activity
       WHERE pid = $1`,
      [processId]
    )
    if (activity.rows[0]?.waitEventType === 'Lock') return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(
    'Bookmark archive transaction이 row lock을 기다리지 않았습니다.'
  )
}

beforeAll(async () => {
  await database.checkReadiness()
  const questions = await readPublishedQuestions()
  if (questions.length < 3) {
    throw new Error('Bookmark integration에는 공개 문제 3개가 필요합니다.')
  }
})

afterAll(async () => {
  if (createdUserIds.size > 0) {
    await database.client.user.deleteMany({
      where: { id: { in: [...createdUserIds] } }
    })
  }
  await database.disconnect()
})

describe.sequential('Bookmark PostgreSQL integration', () => {
  it('동시 PUT과 반복 DELETE가 owner별 하나의 logical row로 수렴한다', async () => {
    const userId = await createUser('concurrent')
    const [question] = await readPublishedQuestions()
    if (!question) throw new Error('Bookmark question fixture가 필요합니다.')

    const created = await Promise.all(
      Array.from({ length: 8 }, () =>
        bookmarkService.create(userId, question.id)
      )
    )

    expect(created.filter(({ created: won }) => won)).toHaveLength(1)
    expect(new Set(created.map(({ bookmark }) => bookmark.questionId))).toEqual(
      new Set([question.id])
    )
    expect(
      new Set(created.map(({ bookmark }) => bookmark.createdAt))
    ).toHaveLength(1)
    await expect(
      database.client.bookmark.count({
        where: { userId, questionId: question.id }
      })
    ).resolves.toBe(1)

    await Promise.all([
      bookmarkService.delete(userId, question.id),
      bookmarkService.delete(userId, question.id)
    ])
    await bookmarkService.delete(userId, question.id)
    await expect(
      database.client.bookmark.count({
        where: { userId, questionId: question.id }
      })
    ).resolves.toBe(0)
  })

  it('owner, filter, stable pagination과 큰 page offset을 격리한다', async () => {
    const ownerId = await createUser('owner-list')
    const foreignId = await createUser('foreign-list')
    const questions = await readPublishedQuestions()
    const [first, second, third] = questions
    if (!first || !second || !third) {
      throw new Error('Bookmark list fixture가 필요합니다.')
    }
    const newestAt = new Date('2026-08-21T02:00:00.000Z')
    const tiedAt = new Date('2026-08-21T01:00:00.000Z')
    await database.client.bookmark.createMany({
      data: [
        {
          id: '018f6b7a-1f4b-7d5e-8a91-000000000001',
          userId: ownerId,
          questionId: first.id,
          createdAt: newestAt
        },
        {
          id: '018f6b7a-1f4b-7d5e-8a91-000000000002',
          userId: ownerId,
          questionId: second.id,
          createdAt: tiedAt
        },
        {
          id: '018f6b7a-1f4b-7d5e-8a91-000000000003',
          userId: ownerId,
          questionId: third.id,
          createdAt: tiedAt
        },
        {
          id: randomUUID(),
          userId: foreignId,
          questionId: first.id,
          createdAt: newestAt
        }
      ]
    })

    await expect(
      bookmarkService.list(ownerId, { page: 1, pageSize: 2 })
    ).resolves.toMatchObject({
      items: [{ questionId: first.id }, { questionId: second.id }],
      page: 1,
      pageSize: 2,
      total: 3
    })
    await expect(
      bookmarkService.list(ownerId, {
        page: 1,
        pageSize: 20,
        questionIds: [third.id]
      })
    ).resolves.toMatchObject({
      items: [{ questionId: third.id }],
      total: 1
    })
    await expect(
      bookmarkService.list(ownerId, {
        page: Number.MAX_SAFE_INTEGER,
        pageSize: 20
      })
    ).resolves.toEqual({
      items: [],
      page: Number.MAX_SAFE_INTEGER,
      pageSize: 20,
      total: 3
    })

    await bookmarkService.delete(ownerId, first.id)
    await expect(
      database.client.bookmark.count({
        where: { userId: foreignId, questionId: first.id }
      })
    ).resolves.toBe(1)
  })

  it('기존 Bookmark의 public snapshot은 archive 뒤에도 보존하고 신규 추가는 막는다', async () => {
    const ownerId = await createUser('archive-owner')
    const foreignId = await createUser('archive-foreign')
    const [question] = await readPublishedQuestions()
    if (!question) throw new Error('Bookmark archive fixture가 필요합니다.')
    const originalQuestion = await database.client.question.findUniqueOrThrow({
      where: { id: question.id },
      select: {
        archivedAt: true,
        currentPublishedVersionId: true,
        lifecycleStatus: true
      }
    })
    const initial = await bookmarkService.create(ownerId, question.id)

    try {
      await database.client.question.update({
        where: { id: question.id },
        data: {
          archivedAt: new Date('2026-08-21T03:00:00.000Z'),
          currentPublishedVersionId: null,
          lifecycleStatus: 'ARCHIVED'
        }
      })

      const listed = await bookmarkService.list(ownerId, {
        page: 1,
        pageSize: 20
      })
      const repeated = await bookmarkService.create(ownerId, question.id)
      expect(listed.items).toEqual([
        expect.objectContaining({
          availability: 'ARCHIVED',
          questionId: question.id,
          question: expect.objectContaining({
            questionVersionId: question.questionVersionId
          })
        })
      ])
      expect(repeated).toMatchObject({
        created: false,
        bookmark: {
          availability: 'ARCHIVED',
          createdAt: initial.bookmark.createdAt,
          questionId: question.id
        }
      })
      await expect(
        bookmarkService.create(foreignId, question.id)
      ).rejects.toMatchObject({ code: 'QUESTION_NOT_AVAILABLE' })
      const keys = new Set<string>()
      collectKeys(listed, keys)
      ;[
        'answer',
        'correctOptionId',
        'explanationJa',
        'explanationKo',
        'ownerId',
        'userId'
      ].forEach((key) => expect(keys).not.toContain(key))
    } finally {
      await database.client.question.update({
        where: { id: question.id },
        data: originalQuestion
      })
    }
  })

  it('BOOKMARK mode는 createdAt과 stable question ID 순서로 partial v2 session을 만든다', async () => {
    const ownerId = await createUser('mode-owner')
    const foreignId = await createUser('mode-foreign')
    const questions = await readPublishedQuestions()
    const [first, second, third] = questions
    if (!first || !second || !third) {
      throw new Error('Bookmark mode fixture가 필요합니다.')
    }
    const newestAt = new Date('2026-08-21T05:00:00.000Z')
    const tiedAt = new Date('2026-08-21T04:00:00.000Z')
    await database.client.bookmark.createMany({
      data: [
        {
          id: randomUUID(),
          userId: ownerId,
          questionId: first.id,
          createdAt: newestAt
        },
        {
          id: randomUUID(),
          userId: ownerId,
          questionId: second.id,
          createdAt: tiedAt
        },
        {
          id: randomUUID(),
          userId: ownerId,
          questionId: third.id,
          createdAt: tiedAt
        }
      ]
    })
    const expectedTieOrder = [second.id, third.id].toSorted()
    const now = new Date('2026-08-21T06:00:00.000Z')
    const studyService = createStudySessionService(
      studySessionRepository,
      () => now
    )

    const created = await studyService.create(
      {
        count: 20,
        level: 'N5',
        mode: 'BOOKMARK',
        subject: 'VOCABULARY'
      },
      { kind: 'USER', userId: ownerId },
      2
    )

    expect(created.payload.session).toMatchObject({
      actualCount: 3,
      mode: 'BOOKMARK',
      requestedCount: 20,
      status: 'IN_PROGRESS',
      usedFallback: false
    })
    expect(
      created.payload.questions.map(({ question }) => question.id)
    ).toEqual([first.id, ...expectedTieOrder])
    expect(
      created.payload.questions.map(
        ({ question }) => question.questionVersionId
      )
    ).toEqual([
      first.questionVersionId,
      ...expectedTieOrder.map(
        (questionId) =>
          questions.find(({ id }) => id === questionId)?.questionVersionId
      )
    ])
    await expect(
      database.client.studyDraft.findUnique({
        where: { studySessionId: created.payload.session.id }
      })
    ).resolves.toMatchObject({ revision: 0 })

    await expect(
      studyService.create(
        {
          count: 20,
          level: 'N5',
          mode: 'BOOKMARK',
          subject: 'VOCABULARY'
        },
        { kind: 'USER', userId: foreignId },
        2
      )
    ).rejects.toMatchObject({ code: 'NO_ELIGIBLE_QUESTIONS' })
  })

  it('BOOKMARK selection과 archive를 직렬화하고 이미 선택한 version pin을 보존한다', async () => {
    const ownerId = await createUser('archive-race')
    const [question] = await readPublishedQuestions()
    if (!question) throw new Error('Bookmark race fixture가 필요합니다.')
    await bookmarkService.create(ownerId, question.id)

    const schema = getPostgresSchema(environment.DATABASE_URL)
    const connectionOptions = schema
      ? { options: `-c search_path=${schema}` }
      : {}
    const archiveClient = new Client({
      connectionString: environment.DATABASE_URL,
      ...connectionOptions
    })
    const observerClient = new Client({
      connectionString: environment.DATABASE_URL,
      ...connectionOptions
    })
    let releaseSelection = (): void => undefined
    const selectionRelease = new Promise<void>((resolve) => {
      releaseSelection = resolve
    })
    let reportSelection!: (
      selected: readonly { questionId: string; questionVersionId: string }[]
    ) => void
    const selectionLocked = new Promise<
      readonly { questionId: string; questionVersionId: string }[]
    >((resolve) => {
      reportSelection = resolve
    })
    const raceRepository = createPrismaStudySessionRepository(database.client, {
      afterSelectionLocked: async (selected) => {
        reportSelection(selected)
        await selectionRelease
      }
    })
    const raceService = createStudySessionService(
      raceRepository,
      () => new Date('2026-08-21T08:00:00.000Z')
    )
    let createPromise: ReturnType<typeof raceService.create> | undefined
    let archiveUpdate: Promise<unknown> | undefined
    let archiveTransactionOpen = false
    let archiveCommitted = false
    let originalQuestion:
      | {
          archivedAt: Date | null
          currentPublishedVersionId: string | null
          lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
          updatedAt: Date
        }
      | undefined

    try {
      await Promise.all([archiveClient.connect(), observerClient.connect()])
      createPromise = raceService.create(
        {
          count: 1,
          level: 'N5',
          mode: 'BOOKMARK',
          subject: 'VOCABULARY'
        },
        { kind: 'USER', userId: ownerId },
        2
      )
      const selected = await Promise.race([
        selectionLocked,
        createPromise.then(() => {
          throw new Error('BOOKMARK session creation bypassed the lock hook.')
        })
      ])
      expect(selected).toEqual([
        {
          questionId: question.id,
          questionVersionId: question.questionVersionId
        }
      ])
      const original = await observerClient.query<{
        archivedAt: Date | null
        currentPublishedVersionId: string | null
        lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
        updatedAt: Date
      }>(
        `SELECT
           "archivedAt",
           "currentPublishedVersionId",
           "lifecycleStatus",
           "updatedAt"
         FROM "Question"
         WHERE "id" = $1`,
        [question.id]
      )
      originalQuestion = original.rows[0]
      if (!originalQuestion) {
        throw new Error('Bookmark race restore fixture가 필요합니다.')
      }
      const backend = await archiveClient.query<{ processId: number }>(
        'SELECT pg_backend_pid() AS "processId"'
      )
      const processId = backend.rows[0]?.processId
      if (processId === undefined) {
        throw new Error('Bookmark archive backend PID가 필요합니다.')
      }

      await archiveClient.query('BEGIN')
      archiveTransactionOpen = true
      let archiveSettled = false
      archiveUpdate = archiveClient
        .query(
          `UPDATE "Question"
           SET
             "lifecycleStatus" = 'ARCHIVED',
             "archivedAt" = $2,
             "currentPublishedVersionId" = NULL,
             "updatedAt" = $2
           WHERE "id" = $1`,
          [question.id, new Date('2026-08-21T08:00:01.000Z')]
        )
        .finally(() => {
          archiveSettled = true
        })

      await waitForPostgresLockWait(observerClient, processId)
      expect(archiveSettled).toBe(false)
      releaseSelection()

      const created = await createPromise
      await archiveUpdate
      await archiveClient.query('COMMIT')
      archiveTransactionOpen = false
      archiveCommitted = true
      expect(created.payload.questions).toHaveLength(1)
      expect(created.payload.questions[0]?.question).toMatchObject({
        id: question.id,
        questionVersionId: question.questionVersionId
      })
      await expect(
        raceService.create(
          {
            count: 1,
            level: 'N5',
            mode: 'BOOKMARK',
            subject: 'VOCABULARY'
          },
          { kind: 'USER', userId: ownerId },
          2
        )
      ).rejects.toMatchObject({ code: 'NO_ELIGIBLE_QUESTIONS' })
    } finally {
      releaseSelection()
      await createPromise?.catch(() => undefined)
      await archiveUpdate?.catch(() => undefined)
      if (archiveTransactionOpen) {
        await archiveClient.query('ROLLBACK').catch(() => undefined)
      }
      if (archiveCommitted && originalQuestion) {
        await observerClient.query(
          `UPDATE "Question"
           SET
             "lifecycleStatus" = $2,
             "archivedAt" = $3,
             "currentPublishedVersionId" = $4,
             "updatedAt" = $5
           WHERE "id" = $1`,
          [
            question.id,
            originalQuestion.lifecycleStatus,
            originalQuestion.archivedAt,
            originalQuestion.currentPublishedVersionId,
            originalQuestion.updatedAt
          ]
        )
      }
      await Promise.all([
        archiveClient.end().catch(() => undefined),
        observerClient.end().catch(() => undefined)
      ])
    }
  }, 15_000)
})

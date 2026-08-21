import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { getPostgresSchema } from '../db/databaseOptions.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
const createdUserIds = new Set<string>()
const createdSessionIds = new Set<string>()

const createUser = async (label: string): Promise<string> => {
  const user = await database.client.user.create({
    data: {
      name: `Slice3 ${label}`,
      email: `slice3-migration-${label}-${randomUUID()}@example.test`,
      emailVerified: true
    },
    select: { id: true }
  })
  createdUserIds.add(user.id)
  return user.id
}

const getPinnedQuestions = async (count: number) => {
  const questions = await database.client.question.findMany({
    where: {
      lifecycleStatus: 'ACTIVE',
      currentPublishedVersionId: { not: null },
      currentPublishedVersion: {
        is: { level: 'N5', subject: 'VOCABULARY', status: 'PUBLISHED' }
      }
    },
    orderBy: { id: 'asc' },
    take: count,
    select: { id: true, currentPublishedVersionId: true }
  })
  if (
    questions.length !== count ||
    questions.some(
      ({ currentPublishedVersionId }) => currentPublishedVersionId === null
    )
  ) {
    throw new Error('StudySession migration question fixture가 부족합니다.')
  }
  return questions as Array<{ id: string; currentPublishedVersionId: string }>
}

const createCompleteSession = async (
  userId: string,
  questions: Array<{ id: string; currentPublishedVersionId: string }>
): Promise<string> => {
  const sessionId = await database.client.$transaction(async (transaction) => {
    const session = await transaction.studySession.create({
      data: {
        userId,
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        status: 'IN_PROGRESS',
        requestedCount: questions.length,
        actualCount: questions.length,
        usedFallback: false,
        startedAt: new Date('2026-08-14T00:00:00.000Z'),
        expiresAt: new Date('2026-08-15T00:00:00.000Z')
      },
      select: { id: true }
    })
    await transaction.studySessionQuestion.createMany({
      data: questions.map((question, index) => ({
        id: randomUUID(),
        studySessionId: session.id,
        questionId: question.id,
        questionVersionId: question.currentPublishedVersionId,
        ordinal: index + 1
      }))
    })
    return session.id
  })
  createdSessionIds.add(sessionId)
  return sessionId
}

beforeAll(async () => {
  await database.checkReadiness()
})

afterAll(async () => {
  if (createdSessionIds.size > 0) {
    await database.client.studySession.deleteMany({
      where: { id: { in: [...createdSessionIds] } }
    })
  }
  if (createdUserIds.size > 0) {
    await database.client.user.deleteMany({
      where: { id: { in: [...createdUserIds] } }
    })
  }
  await database.disconnect()
})

describe('StudySession migration invariants', () => {
  it('deferred selection trigger와 인덱스·FK를 실제 catalog에 만든다', async () => {
    const [triggers, indexes, foreignKeys] = await Promise.all([
      database.client.$queryRaw<
        Array<{
          name: string
          deferrable: boolean
          initiallyDeferred: boolean
          enabled: string
        }>
      >`
        SELECT
          tgname AS name,
          tgdeferrable AS deferrable,
          tginitdeferred AS "initiallyDeferred",
          tgenabled::text AS enabled
        FROM pg_trigger
        WHERE tgrelid IN (
          '"StudySession"'::regclass,
          '"StudySessionQuestion"'::regclass
        ) AND NOT tgisinternal
        ORDER BY tgname`,
      database.client.$queryRaw<Array<{ name: string }>>`
        SELECT indexname AS name
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename IN ('StudySession', 'StudySessionQuestion')`,
      database.client.$queryRaw<Array<{ deleteAction: string; name: string }>>`
        SELECT conname AS name, confdeltype::text AS "deleteAction"
        FROM pg_constraint
        WHERE contype = 'f'
          AND conrelid IN (
            '"StudySession"'::regclass,
            '"StudySessionQuestion"'::regclass
          )`
    ])

    expect(triggers.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'StudySession_validate_change',
        'StudySession_protect_created_at',
        'StudySessionQuestion_validate_change',
        'StudySession_validate_selection_complete'
      ])
    )
    expect(triggers).toContainEqual(
      expect.objectContaining({
        name: 'StudySession_validate_selection_complete',
        deferrable: true,
        initiallyDeferred: true,
        enabled: 'O'
      })
    )
    expect(indexes.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'StudySession_userId_status_startedAt_idx',
        'StudySession_guestPrincipalId_status_expiresAt_idx',
        'StudySession_status_expiresAt_idx',
        'StudySessionQuestion_studySessionId_ordinal_key',
        'StudySessionQuestion_studySessionId_questionId_key',
        'StudySessionQuestion_studySessionId_questionVersionId_key',
        'StudySessionQuestion_id_questionVersionId_key'
      ])
    )
    expect(foreignKeys).toEqual(
      expect.arrayContaining([
        { name: 'StudySession_userId_fkey', deleteAction: 'c' },
        { name: 'StudySession_guestPrincipalId_fkey', deleteAction: 'c' },
        {
          name: 'StudySessionQuestion_studySessionId_fkey',
          deleteAction: 'c'
        },
        { name: 'StudySessionQuestion_questionId_fkey', deleteAction: 'r' },
        {
          name: 'StudySessionQuestion_questionId_questionVersionId_fkey',
          deleteAction: 'r'
        },
        {
          name: 'StudySession_retryOfStudySessionId_fkey',
          deleteAction: 'a'
        },
        {
          name: 'StudySession_retryOfStudySessionId_userId_fkey',
          deleteAction: 'a'
        },
        {
          name: 'StudySession_retryOfStudySessionId_guestPrincipalId_fkey',
          deleteAction: 'a'
        }
      ])
    )
    expect(foreignKeys).toHaveLength(8)
  })

  it('parent-only와 부족한 selection은 commit 시점에 거부한다', async () => {
    const userId = await createUser('incomplete')
    const questions = await getPinnedQuestions(1)

    await expect(
      database.client.studySession.create({
        data: {
          userId,
          level: 'N5',
          subject: 'VOCABULARY',
          mode: 'RANDOM',
          requestedCount: 1,
          actualCount: 1,
          startedAt: new Date('2026-08-14T00:00:00.000Z'),
          expiresAt: new Date('2026-08-15T00:00:00.000Z')
        }
      })
    ).rejects.toThrow()

    await expect(
      database.client.$transaction(async (transaction) => {
        const session = await transaction.studySession.create({
          data: {
            userId,
            level: 'N5',
            subject: 'VOCABULARY',
            mode: 'RANDOM',
            requestedCount: 2,
            actualCount: 2,
            startedAt: new Date('2026-08-14T00:00:00.000Z'),
            expiresAt: new Date('2026-08-15T00:00:00.000Z')
          }
        })
        await transaction.studySessionQuestion.create({
          data: {
            studySessionId: session.id,
            questionId: questions[0]!.id,
            questionVersionId: questions[0]!.currentPublishedVersionId,
            ordinal: 1
          }
        })
      })
    ).rejects.toThrow()
  })

  it('생성 transaction 안에서도 StudySession id 변경으로 selection 검증을 우회할 수 없다', async () => {
    const userId = await createUser('identity')

    await expect(
      database.client.$transaction(async (transaction) => {
        const session = await transaction.studySession.create({
          data: {
            userId,
            level: 'N5',
            subject: 'VOCABULARY',
            mode: 'RANDOM',
            requestedCount: 1,
            actualCount: 1,
            startedAt: new Date('2026-08-14T00:00:00.000Z'),
            expiresAt: new Date('2026-08-15T00:00:00.000Z')
          },
          select: { id: true }
        })

        await transaction.studySession.update({
          where: { id: session.id },
          data: { id: randomUUID() }
        })
      })
    ).rejects.toThrow()
  })

  it('forward guard가 legacy incomplete aggregate를 migration 시점에 거부한다', async () => {
    const schema = getPostgresSchema(environment.DATABASE_URL)
    if (!schema) {
      throw new Error('StudySession migration test schema가 필요합니다.')
    }
    const migrationSql = readFileSync(
      fileURLToPath(
        new URL(
          '../../prisma/migrations/20260814144000_phase3_study_session_existing_selection_guard/migration.sql',
          import.meta.url
        )
      ),
      'utf8'
    )
    const client = new Client({
      connectionString: environment.DATABASE_URL,
      options: `-c search_path=${schema}`
    })
    const userId = randomUUID()
    const sessionId = randomUUID()
    let connected = false

    try {
      await client.connect()
      connected = true
      await client.query(
        `INSERT INTO "User" (
          "id", "name", "email", "emailVerified", "role", "accountStatus",
          "createdAt", "updatedAt"
        ) VALUES ($1, 'Legacy guard user', $2, true, 'USER', 'ACTIVE', now(), now())`,
        [userId, `slice3-guard-${randomUUID()}@example.test`]
      )
      await client.query('BEGIN')
      await client.query(
        'ALTER TABLE "StudySession" DISABLE TRIGGER "StudySession_validate_selection_complete"'
      )
      await client.query(
        `INSERT INTO "StudySession" (
          "id", "userId", "level", "subject", "mode", "status",
          "requestedCount", "actualCount", "usedFallback",
          "startedAt", "expiresAt", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 'N5', 'VOCABULARY', 'RANDOM', 'IN_PROGRESS',
          1, 1, false, $3, $4, $3, $3
        )`,
        [
          sessionId,
          userId,
          new Date('2026-08-14T00:00:00.000Z'),
          new Date('2026-08-15T00:00:00.000Z')
        ]
      )
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query(
        'ALTER TABLE "StudySession" ENABLE TRIGGER "StudySession_validate_selection_complete"'
      )
      await client.query('COMMIT')

      await expect(client.query(migrationSql)).rejects.toMatchObject({
        code: '23514'
      })
      await client.query('ROLLBACK')
    } finally {
      if (connected) {
        await client.query('ROLLBACK').catch(() => undefined)
        await client
          .query('DELETE FROM "StudySession" WHERE "id" = $1', [sessionId])
          .catch(() => undefined)
        await client
          .query('DELETE FROM "User" WHERE "id" = $1', [userId])
          .catch(() => undefined)
        await client.end()
      }
    }
  })

  it('owner/count/fallback/time check와 cross-question version FK를 거부한다', async () => {
    const userId = await createUser('checks')
    const questions = await getPinnedQuestions(2)
    const base = {
      level: 'N5' as const,
      subject: 'VOCABULARY' as const,
      mode: 'RANDOM' as const,
      requestedCount: 1,
      actualCount: 1,
      startedAt: new Date('2026-08-14T00:00:00.000Z'),
      expiresAt: new Date('2026-08-15T00:00:00.000Z')
    }

    for (const invalid of [
      { ...base, userId: null, guestPrincipalId: null },
      { ...base, userId, guestPrincipalId: randomUUID() },
      { ...base, userId, requestedCount: 21, actualCount: 21 },
      {
        ...base,
        userId,
        usedFallback: true,
        fallbackReason: 'INSUFFICIENT_MODE_CANDIDATES' as const
      },
      { ...base, userId, expiresAt: base.startedAt }
    ]) {
      await expect(
        database.client.studySession.create({ data: invalid })
      ).rejects.toThrow()
    }

    await expect(
      database.client.$transaction(async (transaction) => {
        const session = await transaction.studySession.create({
          data: { ...base, userId }
        })
        await transaction.studySessionQuestion.create({
          data: {
            studySessionId: session.id,
            questionId: questions[0]!.id,
            questionVersionId: questions[1]!.currentPublishedVersionId,
            ordinal: 1
          }
        })
      })
    ).rejects.toThrow()
  })

  it('완성된 ordered version selection은 이후 변경할 수 없다', async () => {
    const userId = await createUser('immutable')
    const questions = await getPinnedQuestions(2)
    const sessionId = await createCompleteSession(userId, questions)
    const children = await database.client.studySessionQuestion.findMany({
      where: { studySessionId: sessionId },
      orderBy: { ordinal: 'asc' }
    })

    await expect(
      database.client.studySessionQuestion.update({
        where: { id: children[0]!.id },
        data: { ordinal: 2 }
      })
    ).rejects.toThrow()
    await expect(
      database.client.studySessionQuestion.delete({
        where: { id: children[0]!.id }
      })
    ).rejects.toThrow()
    await expect(
      database.client.studySessionQuestion.create({
        data: {
          studySessionId: sessionId,
          questionId: questions[0]!.id,
          questionVersionId: questions[0]!.currentPublishedVersionId,
          ordinal: 3
        }
      })
    ).rejects.toThrow()
    await expect(
      database.client.studySession.update({
        where: { id: sessionId },
        data: { requestedCount: 3 }
      })
    ).rejects.toThrow()
    await expect(
      database.client.studySession.update({
        where: { id: sessionId },
        data: { createdAt: new Date('2026-08-14T00:01:00.000Z') }
      })
    ).rejects.toThrow()
  })

  it('Session 또는 User 삭제 cascade는 immutable child trigger를 안전하게 통과한다', async () => {
    const directUserId = await createUser('session-cascade')
    const question = await getPinnedQuestions(1)
    const directSessionId = await createCompleteSession(directUserId, question)

    await database.client.studySession.delete({
      where: { id: directSessionId }
    })
    createdSessionIds.delete(directSessionId)
    expect(
      await database.client.studySessionQuestion.count({
        where: { studySessionId: directSessionId }
      })
    ).toBe(0)

    const userId = await createUser('user-cascade')
    const sessionId = await createCompleteSession(userId, question)
    await database.client.user.delete({ where: { id: userId } })
    createdUserIds.delete(userId)
    createdSessionIds.delete(sessionId)
    expect(
      await database.client.studySession.findUnique({
        where: { id: sessionId }
      })
    ).toBeNull()
  })
})

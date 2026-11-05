import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { eraseTestUser } from '../db/fixtures/accountErasure.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const isCurrentSourceIntegration =
  process.env.API_INTEGRATION_CURRENT_SOURCE === '1'
const fixtureDatabaseUrl = process.env.API_INTEGRATION_FIXTURE_DATABASE_URL
const appFixtureDatabaseUrl = process.env.TEST_APP_FIXTURE_DATABASE_URL
if (
  isCurrentSourceIntegration &&
  (!fixtureDatabaseUrl || !appFixtureDatabaseUrl)
) {
  throw new Error(
    'StudySession migration tests require fixture and erasure databases.'
  )
}
for (const databaseUrl of [fixtureDatabaseUrl, appFixtureDatabaseUrl]) {
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
const erasureWorkerClient = appFixtureDatabaseUrl
  ? new Client({
      connectionString: appFixtureDatabaseUrl,
      options: createPostgresStartupOptions(
        getPostgresSchema(appFixtureDatabaseUrl)
      )
    })
  : undefined
const createdUserIds = new Set<string>()
const createdSessionIds = new Set<string>()

const createUser = async (label: string): Promise<string> => {
  const userId = randomUUID()
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        id: userId,
        name: `Slice3 ${label}`,
        email: `slice3-migration-${label}-${randomUUID()}@example.test`,
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

const eraseUser = async (userId: string): Promise<void> => {
  if (!erasureWorkerClient) {
    await fixtureDatabase.client.user.delete({ where: { id: userId } })
    return
  }
  await eraseTestUser(database.client, userId)
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
  const startedAt = new Date('2026-08-14T00:00:00.000Z')
  const sessionId = await database.client.$transaction(async (transaction) => {
    const session = await transaction.studySession.create({
      data: {
        userId,
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        practiceContractVersion: 2,
        status: 'IN_PROGRESS',
        requestedCount: questions.length,
        actualCount: questions.length,
        usedFallback: false,
        startedAt,
        expiresAt: new Date('2026-08-15T00:00:00.000Z')
      },
      select: { id: true }
    })
    const sessionQuestions = questions.map((question, index) => ({
      id: randomUUID(),
      studySessionId: session.id,
      questionId: question.id,
      questionVersionId: question.currentPublishedVersionId,
      ordinal: index + 1
    }))
    await transaction.studySessionQuestion.createMany({
      data: sessionQuestions
    })
    await transaction.studyDraft.create({
      data: {
        studySessionId: session.id,
        revision: 0,
        currentOrdinal: 1,
        createdAt: startedAt,
        updatedAt: startedAt,
        answers: {
          createMany: {
            data: sessionQuestions.map((question) => ({
              studySessionQuestionId: question.id,
              questionVersionId: question.questionVersionId,
              selectedOptionId: null,
              elapsedSec: 0,
              updatedAt: startedAt
            }))
          }
        }
      }
    })
    return session.id
  })
  createdSessionIds.add(sessionId)
  return sessionId
}

beforeAll(async () => {
  await database.checkReadiness()
  if (erasureWorkerClient) {
    await erasureWorkerClient.connect()
    await erasureWorkerClient.query(`SET ROLE "nihongo_app"`)
  }
})

afterAll(async () => {
  if (!erasureWorkerClient && createdSessionIds.size > 0) {
    await database.client.studySession.deleteMany({
      where: { id: { in: [...createdSessionIds] } }
    })
  }
  if (createdUserIds.size > 0) {
    for (const userId of createdUserIds) {
      await eraseUser(userId)
    }
  }
  if (erasureWorkerClient) {
    await erasureWorkerClient.end()
  }
  if (fixtureDatabase !== database) {
    await fixtureDatabase.disconnect()
  }
  await database.disconnect()
})

describe('StudySession migration invariants', () => {
  it('trigger 없이 인덱스·FK를 실제 catalog에 만든다', async () => {
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

    // #504 P1: selection and state rules live in the API services.
    expect(triggers).toEqual([])
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

  it('Session 삭제와 승인된 User erasure cascade가 child row를 함께 지운다', async () => {
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
    if (isCurrentSourceIntegration) {
      await expect(
        database.client.user.delete({ where: { id: userId } })
      ).rejects.toThrow()
      expect(
        await database.client.studySession.findUnique({
          where: { id: sessionId }
        })
      ).not.toBeNull()
    }
    await eraseUser(userId)
    createdUserIds.delete(userId)
    createdSessionIds.delete(sessionId)
    expect(
      await database.client.studySession.findUnique({
        where: { id: sessionId }
      })
    ).toBeNull()
  })
})

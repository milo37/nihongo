import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { createPrismaStudySessionRepository } from '../study/studySessionRepository.js'
import { createStudySessionService } from '../study/studySessionService.js'
import { createPracticeRuntimeGate } from '../lifecycle/practiceRuntimeGate.js'
import { createDatabaseRuntime } from './database.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from './databaseOptions.js'
import { assertSafeTestDatabase } from './databaseTargetGuard.js'
import { PracticeCompatibilityFenceError } from './practiceCompatibilityFence.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(
  environment.DATABASE_URL,
  process.env.PHASE10_CURRENT_SOURCE_INTEGRATION === '1'
    ? { migrationProfile: 'current', startupRole: 'nihongo_app' }
    : {}
)
const isPhase10CurrentSource =
  process.env.PHASE10_CURRENT_SOURCE_INTEGRATION === '1'
const fixtureDatabaseUrl = process.env.PHASE10_FIXTURE_DATABASE_URL
const erasureWorkerDatabaseUrl = process.env.PHASE7_API_ERASURE_DATABASE_URL
if (
  isPhase10CurrentSource &&
  (!fixtureDatabaseUrl || !erasureWorkerDatabaseUrl)
) {
  throw new Error(
    'Phase 10 current-source compatibility tests require fixture and erasure databases.'
  )
}
if (fixtureDatabaseUrl) {
  assertSafeTestDatabase({
    nodeEnvironment: environment.NODE_ENV,
    databaseUrl: fixtureDatabaseUrl,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
}
if (erasureWorkerDatabaseUrl) {
  assertSafeTestDatabase({
    nodeEnvironment: environment.NODE_ENV,
    databaseUrl: erasureWorkerDatabaseUrl,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
}
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
const studySessionService = createStudySessionService(
  createPrismaStudySessionRepository(database.client)
)
const guestPrincipalIds = new Set<string>()
const userIds = new Set<string>()

beforeAll(async () => {
  if (erasureWorkerClient) {
    await erasureWorkerClient.connect()
    await erasureWorkerClient.query(`SET ROLE "nihongo_erasure_worker"`)
  }
})

afterEach(async () => {
  if (guestPrincipalIds.size > 0) {
    await database.client.guestPrincipal.deleteMany({
      where: { id: { in: [...guestPrincipalIds] } }
    })
    guestPrincipalIds.clear()
  }
  if (userIds.size > 0) {
    if (erasureWorkerClient) {
      for (const userId of userIds) {
        await erasureWorkerClient.query(
          `SELECT "phase7_erase_user"($1, 'TEST')`,
          [userId]
        )
      }
    } else {
      await fixtureDatabase.client.user.deleteMany({
        where: { id: { in: [...userIds] } }
      })
    }
    userIds.clear()
  }
})

afterAll(async () => {
  if (erasureWorkerClient) {
    await erasureWorkerClient.end()
  }
  if (fixtureDatabase !== database) {
    await fixtureDatabase.disconnect()
  }
  await database.disconnect()
})

describe('practice compatibility pre-listen fence', () => {
  it('zero facts만 허용하고 첫 v2 session 뒤에는 row 삭제 전까지 거부한다', async () => {
    const runtimeGate = createPracticeRuntimeGate({
      runtime: 'v1-compatible',
      authority: {
        generationLeaseId: '550e8400-e29b-41d4-a716-446655440000',
        assertValid: () => undefined
      },
      checkDatabaseReadiness: database.checkReadiness,
      checkV1Compatibility: database.checkV1Compatibility
    })
    await expect(runtimeGate.checkReadiness()).resolves.toBeUndefined()

    const credential = guestPrincipalService.prepareCredential()
    guestPrincipalIds.add(credential.id)
    await studySessionService.create(
      {
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      },
      { kind: 'NEW_GUEST', credential },
      2
    )

    await expect(database.checkV1Compatibility()).rejects.toBeInstanceOf(
      PracticeCompatibilityFenceError
    )
    await expect(runtimeGate.assertRequestAuthority()).rejects.toBeInstanceOf(
      PracticeCompatibilityFenceError
    )

    await database.client.guestPrincipal.delete({
      where: { id: credential.id }
    })
    guestPrincipalIds.delete(credential.id)
    await expect(database.checkV1Compatibility()).resolves.toBeUndefined()
  })

  it('Bookmark fact 하나도 v1-compatible runtime을 fail-closed 처리한다', async () => {
    const runtimeGate = createPracticeRuntimeGate({
      runtime: 'v1-compatible',
      authority: {
        generationLeaseId: '550e8400-e29b-41d4-a716-446655440000',
        assertValid: () => undefined
      },
      checkDatabaseReadiness: database.checkReadiness,
      checkV1Compatibility: database.checkV1Compatibility
    })
    const userId = randomUUID()
    await fixtureDatabase.client.$transaction(async (transaction) => {
      await transaction.user.create({
        data: {
          id: userId,
          email: `slice4-fence-${randomUUID()}@example.test`,
          emailVerified: true,
          name: 'Slice 4 fence'
        }
      })
      await transaction.account.create({
        data: {
          accountId: userId,
          password: 'phase10-fixture-password-hash',
          providerId: 'credential',
          userId
        }
      })
    })
    userIds.add(userId)
    const question = await database.client.question.findFirstOrThrow({
      where: {
        lifecycleStatus: 'ACTIVE',
        currentPublishedVersion: { is: { status: 'PUBLISHED' } }
      },
      orderBy: { id: 'asc' },
      select: { id: true }
    })

    await database.client.bookmark.create({
      data: {
        id: randomUUID(),
        userId,
        questionId: question.id
      }
    })

    await expect(database.checkV1Compatibility()).rejects.toBeInstanceOf(
      PracticeCompatibilityFenceError
    )
    await expect(runtimeGate.assertRequestAuthority()).rejects.toBeInstanceOf(
      PracticeCompatibilityFenceError
    )

    await database.client.bookmark.deleteMany({
      where: { userId }
    })
    await expect(database.checkV1Compatibility()).resolves.toBeUndefined()
  })
})

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
import {
  redactExpiredUserReportDescriptions,
  USER_REPORT_RETENTION_REDACTED_DESCRIPTION
} from './userReportRetention.js'
import { eraseTestUser } from '../db/fixtures/accountErasure.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const schema = getPostgresSchema(environment.DATABASE_URL)
if (!schema)
  throw new Error('User report retention integration test schema가 필요합니다.')

const isCurrentSourceIntegration =
  process.env.API_INTEGRATION_CURRENT_SOURCE === '1'
const fixtureDatabaseUrl = process.env.API_INTEGRATION_FIXTURE_DATABASE_URL
const appFixtureDatabaseUrl = process.env.TEST_APP_FIXTURE_DATABASE_URL
if (
  isCurrentSourceIntegration &&
  (!fixtureDatabaseUrl || !appFixtureDatabaseUrl)
) {
  throw new Error(
    'User report retention integration requires fixture and erasure databases.'
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
const client = new Client({
  connectionString: environment.DATABASE_URL,
  options: createPostgresStartupOptions(
    schema,
    isCurrentSourceIntegration ? 'nihongo_app' : undefined
  )
})
const erasureWorkerClient = appFixtureDatabaseUrl
  ? new Client({
      connectionString: appFixtureDatabaseUrl,
      options: createPostgresStartupOptions(
        getPostgresSchema(appFixtureDatabaseUrl)
      )
    })
  : undefined
const createdUserIds = new Set<string>()
const createdReportIds = new Set<string>()

const createUser = async (label: string): Promise<string> => {
  const id = randomUUID()
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        id,
        email: `user-report-retention-${randomUUID()}@example.test`,
        emailVerified: true,
        name: `User report ${label}`
      }
    })
    await fixture.account.create({
      data: {
        accountId: id,
        password: 'test-fixture-password-hash',
        providerId: 'credential',
        userId: id
      }
    })
  })
  createdUserIds.add(id)
  return id
}

const eraseUser = async (userId: string): Promise<void> => {
  if (erasureWorkerClient) {
    await eraseTestUser(database.client, userId)
  } else {
    await client.query('DELETE FROM "User" WHERE "id" = $1', [userId])
  }
  createdUserIds.delete(userId)
}

const DAY_MS = 86_400_000

const insertReport = async ({
  closedDaysAgo,
  description = '앱이 멈춥니다.',
  reporterUserId,
  status
}: {
  closedDaysAgo: number | null
  description?: string
  reporterUserId: string
  status: 'RECEIVED' | 'ANSWERED' | 'CLOSED'
}): Promise<string> => {
  const id = randomUUID()
  const closedAt =
    closedDaysAgo === null
      ? null
      : new Date(asOf.getTime() - closedDaysAgo * DAY_MS)
  await fixtureDatabase.client.$executeRawUnsafe(
    `INSERT INTO "UserReport" ("id", "kind", "status", "location", "description",
       "reporterUserId", "reporterReply", "repliedAt", "closedAt", "createdAt")
     VALUES ($1::uuid, 'APP_ERROR', $2, '/study', $3, $4::uuid, $5, $6, $7, $8)`,
    id,
    status,
    description,
    reporterUserId,
    status === 'ANSWERED' ? '확인했습니다.' : null,
    status === 'ANSWERED' ? closedAt : null,
    status === 'RECEIVED' ? null : closedAt,
    new Date(asOf.getTime() - 400 * DAY_MS)
  )
  createdReportIds.add(id)
  return id
}

const readReport = async (id: string) => {
  const result = await client.query<{
    description: string
    rowVersion: number
    status: string
  }>(
    'SELECT "description", "rowVersion", "status" FROM "UserReport" WHERE "id" = $1',
    [id]
  )
  return result.rows[0]
}

let asOf: Date

beforeAll(async () => {
  await client.connect()
  if (erasureWorkerClient) {
    await erasureWorkerClient.connect()
    await erasureWorkerClient.query(`SET ROLE "nihongo_app"`)
  }
  const now = await client.query<{ now: Date }>(
    'SELECT clock_timestamp() AS "now"'
  )
  asOf = now.rows[0]!.now
})

afterAll(async () => {
  for (const userId of createdUserIds) {
    await eraseUser(userId).catch(() => undefined)
  }
  if (createdReportIds.size > 0) {
    await fixtureDatabase.client
      .$executeRawUnsafe(
        'DELETE FROM "UserReport" WHERE "id" = ANY($1::uuid[])',
        [...createdReportIds]
      )
      .catch(() => undefined)
  }
  await Promise.all([
    client.end(),
    erasureWorkerClient?.end(),
    database.disconnect(),
    fixtureDatabase === database ? undefined : fixtureDatabase.disconnect()
  ])
})

describe('UserReport 180-day description retention (JLP-702)', () => {
  it('redacts only closed reports at or past 180 days and is idempotent', async () => {
    const reporter = await createUser('retention')
    const day179 = await insertReport({
      closedDaysAgo: 179,
      reporterUserId: reporter,
      status: 'CLOSED'
    })
    const day180 = await insertReport({
      closedDaysAgo: 180,
      reporterUserId: reporter,
      status: 'ANSWERED'
    })
    const day181 = await insertReport({
      closedDaysAgo: 181,
      reporterUserId: reporter,
      status: 'CLOSED'
    })
    const open = await insertReport({
      closedDaysAgo: null,
      reporterUserId: reporter,
      status: 'RECEIVED'
    })

    const preview = await redactExpiredUserReportDescriptions(database.client, {
      asOf,
      batchSize: 100,
      dryRun: true
    })
    expect(preview.redactedCount).toBe(0)
    expect(preview.eligibleCount).toBeGreaterThanOrEqual(2)
    expect((await readReport(day180))?.description).toBe('앱이 멈춥니다.')

    const first = await redactExpiredUserReportDescriptions(database.client, {
      asOf,
      batchSize: 100,
      dryRun: false
    })
    expect(first.redactedCount).toBeGreaterThanOrEqual(2)
    expect(first.hasMore).toBe(false)
    for (const id of [day180, day181]) {
      expect(await readReport(id)).toMatchObject({
        description: USER_REPORT_RETENTION_REDACTED_DESCRIPTION,
        rowVersion: 2
      })
    }
    for (const id of [day179, open]) {
      expect(await readReport(id)).toMatchObject({
        description: '앱이 멈춥니다.',
        rowVersion: 1
      })
    }
    expect((await readReport(day180))?.status).toBe('ANSWERED')

    const again = await redactExpiredUserReportDescriptions(database.client, {
      asOf,
      batchSize: 100,
      dryRun: false
    })
    expect(again).toEqual({
      eligibleCount: 0,
      redactedCount: 0,
      hasMore: false
    })
    expect((await readReport(day181))?.rowVersion).toBe(2)
  })

  it('leaves erasure-redacted reports untouched', async () => {
    const reporter = await createUser('erased')
    const erased = await insertReport({
      closedDaysAgo: 200,
      description: '탈퇴한 회원의 제보 내용은 삭제되었습니다.',
      reporterUserId: reporter,
      status: 'CLOSED'
    })

    await redactExpiredUserReportDescriptions(database.client, {
      asOf,
      batchSize: 100,
      dryRun: false
    })
    expect(await readReport(erased)).toMatchObject({
      description: '탈퇴한 회원의 제보 내용은 삭제되었습니다.',
      rowVersion: 1
    })
  })

  it('stops at the batch size and reports remaining work', async () => {
    const reporter = await createUser('batch')
    const ids = [
      await insertReport({
        closedDaysAgo: 300,
        reporterUserId: reporter,
        status: 'CLOSED'
      }),
      await insertReport({
        closedDaysAgo: 301,
        reporterUserId: reporter,
        status: 'CLOSED'
      })
    ]

    const first = await redactExpiredUserReportDescriptions(database.client, {
      asOf,
      batchSize: 1,
      dryRun: false
    })
    expect(first).toEqual({ eligibleCount: 2, redactedCount: 1, hasMore: true })
    const second = await redactExpiredUserReportDescriptions(database.client, {
      asOf,
      batchSize: 1,
      dryRun: false
    })
    expect(second).toEqual({
      eligibleCount: 1,
      redactedCount: 1,
      hasMore: false
    })
    for (const id of ids) {
      expect((await readReport(id))?.description).toBe(
        USER_REPORT_RETENTION_REDACTED_DESCRIPTION
      )
    }
  })
})

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
  createPrismaAccountRestrictionReader,
  type AccountRestrictionReader
} from './accountRestriction.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const schema = getPostgresSchema(environment.DATABASE_URL)
if (!schema)
  throw new Error('Account restriction integration test schema가 필요합니다.')

const isCurrentSourceIntegration =
  process.env.API_INTEGRATION_CURRENT_SOURCE === '1'
const fixtureDatabaseUrl = process.env.API_INTEGRATION_FIXTURE_DATABASE_URL
const erasureWorkerDatabaseUrl = process.env.TEST_API_ERASURE_DATABASE_URL
if (
  isCurrentSourceIntegration &&
  (!fixtureDatabaseUrl || !erasureWorkerDatabaseUrl)
) {
  throw new Error(
    'Account restriction integration requires fixture and erasure databases.'
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
const client = new Client({
  connectionString: environment.DATABASE_URL,
  options: createPostgresStartupOptions(
    schema,
    isCurrentSourceIntegration ? 'nihongo_app' : undefined
  )
})
const erasureWorkerClient = erasureWorkerDatabaseUrl
  ? new Client({
      connectionString: erasureWorkerDatabaseUrl,
      options: createPostgresStartupOptions(
        getPostgresSchema(erasureWorkerDatabaseUrl)
      )
    })
  : undefined
const createdUserIds = new Set<string>()

const reader: AccountRestrictionReader = createPrismaAccountRestrictionReader(
  database.client
)

const createUser = async (label: string): Promise<string> => {
  const id = randomUUID()
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        id,
        email: `account-restriction-${randomUUID()}@example.test`,
        emailVerified: true,
        name: `Account restriction ${label}`
      }
    })
    await fixture.account.create({
      data: {
        accountId: id,
        password: 'phase10-fixture-password-hash',
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
    await erasureWorkerClient.query(`SELECT "phase7_erase_user"($1, 'TEST')`, [
      userId
    ])
  } else {
    await client.query('DELETE FROM "User" WHERE "id" = $1', [userId])
  }
  createdUserIds.delete(userId)
}

const restrict = async (userId: string, reason: string): Promise<void> => {
  await fixtureDatabase.client.userAccountRestriction.create({
    data: { userId, reason }
  })
}

const restrictionExists = async (userId: string): Promise<boolean> =>
  (await fixtureDatabase.client.userAccountRestriction.findUnique({
    where: { userId }
  })) !== null

beforeAll(async () => {
  await client.connect()
  if (erasureWorkerClient) {
    await erasureWorkerClient.connect()
    await erasureWorkerClient.query(`SET ROLE "nihongo_erasure_worker"`)
  }
})

afterAll(async () => {
  for (const userId of createdUserIds) {
    await eraseUser(userId).catch(() => undefined)
  }
  await Promise.all([
    client.end(),
    erasureWorkerClient?.end(),
    database.disconnect(),
    fixtureDatabase === database ? undefined : fixtureDatabase.disconnect()
  ])
})

describe('UserAccountRestriction (#484)', () => {
  it('reports only the restricted member as restricted', async () => {
    const restricted = await createUser('restricted')
    const member = await createUser('member')
    await restrict(restricted, '반복된 부적절 제보')

    await expect(reader.isRestricted(restricted)).resolves.toBe(true)
    await expect(reader.isRestricted(member)).resolves.toBe(false)
    await expect(reader.isRestricted(randomUUID())).resolves.toBe(false)
  })

  it('rejects an empty or over-long restriction reason', async () => {
    const member = await createUser('reason')
    for (const reason of ['', 'a'.repeat(501)]) {
      await expect(restrict(member, reason)).rejects.toThrow()
    }
    await expect(reader.isRestricted(member)).resolves.toBe(false)
  })

  it('lets the application role read but not write restrictions', async () => {
    const member = await createUser('acl')
    await expect(
      client.query(
        `INSERT INTO "UserAccountRestriction" ("userId", "reason")
           VALUES ($1, 'self-granted')`,
        [member]
      )
    ).rejects.toMatchObject({ code: '42501' })

    await restrict(member, '운영 확인 중')
    await expect(
      client.query('DELETE FROM "UserAccountRestriction" WHERE "userId" = $1', [
        member
      ])
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      client.query(
        `UPDATE "UserAccountRestriction" SET "reason" = 'changed'
           WHERE "userId" = $1`,
        [member]
      )
    ).rejects.toMatchObject({ code: '42501' })
    const visible = await client.query(
      'SELECT "userId" FROM "UserAccountRestriction" WHERE "userId" = $1',
      [member]
    )
    expect(visible.rows).toEqual([{ userId: member }])
  })

  it('removes the restriction together with an erased member', async () => {
    const member = await createUser('erased')
    await restrict(member, '탈퇴 전 제한')
    await eraseUser(member)

    await expect(restrictionExists(member)).resolves.toBe(false)
    await expect(reader.isRestricted(member)).resolves.toBe(false)
  })
})

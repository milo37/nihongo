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
import { createPrismaAccountRestrictionReader } from '../account/accountRestriction.js'
import { createPrismaAdminMemberRepository } from './adminMemberRepository.js'
import { createAdminMemberService } from './adminMemberService.js'
import { eraseTestUser } from '../db/fixtures/accountErasure.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const schema = getPostgresSchema(environment.DATABASE_URL)
if (!schema)
  throw new Error('Admin member integration test schema가 필요합니다.')

const isCurrentSourceIntegration =
  process.env.API_INTEGRATION_CURRENT_SOURCE === '1'
const fixtureDatabaseUrl = process.env.API_INTEGRATION_FIXTURE_DATABASE_URL
const appFixtureDatabaseUrl = process.env.TEST_APP_FIXTURE_DATABASE_URL
if (
  isCurrentSourceIntegration &&
  (!fixtureDatabaseUrl || !appFixtureDatabaseUrl)
) {
  throw new Error(
    'Admin member integration requires fixture and erasure databases.'
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

const repository = createPrismaAdminMemberRepository(database.client)
const service = createAdminMemberService(repository)
const restrictionReader = createPrismaAccountRestrictionReader(database.client)

const createUser = async (
  label: string,
  role: 'USER' | 'ADMIN' = 'USER'
): Promise<{ id: string; email: string }> => {
  const id = randomUUID()
  const email = `member${label}-${randomUUID().slice(0, 8)}@example.test`
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        id,
        email,
        emailVerified: true,
        name: `Admin member ${label}`,
        role
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
  return { id, email }
}

const eraseUser = async (userId: string): Promise<void> => {
  if (erasureWorkerClient) {
    await eraseTestUser(database.client, userId)
  } else {
    await client.query('DELETE FROM "User" WHERE "id" = $1', [userId])
  }
  createdUserIds.delete(userId)
}

let admin: { id: string; email: string }

beforeAll(async () => {
  await client.connect()
  if (erasureWorkerClient) {
    await erasureWorkerClient.connect()
    await erasureWorkerClient.query(`SET ROLE "nihongo_app"`)
  }
  admin = await createUser('admin', 'ADMIN')
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

describe('admin member console (JLP-691)', () => {
  it('returns masked members only', async () => {
    const member = await createUser('list')

    const detail = await service.getMember(admin.id, member.id)
    expect(detail).toMatchObject({
      memberId: member.id,
      status: 'ACTIVE',
      restrictedAt: null,
      restrictionReason: null,
      rowVersion: 1,
      solvedCount: 0,
      reportCount: 0,
      lastStudiedAt: null
    })
    expect(detail.maskedEmail).not.toContain(member.email.split('@')[0])
    expect(detail.maskedEmail).toMatch(/^me\*+@e\*+\.test$/u)

    const byEmail = await service.listMembers(admin.id, {
      email: member.email,
      sort: 'joinedAt',
      order: 'desc',
      page: 1,
      pageSize: 25
    })
    expect(byEmail.items.map((item) => item.memberId)).toEqual([member.id])
    expect(byEmail.total).toBe(1)

    const adminLookup = await service.listMembers(admin.id, {
      email: admin.email,
      sort: 'joinedAt',
      order: 'desc',
      page: 1,
      pageSize: 25
    })
    expect(adminLookup).toMatchObject({ items: [], total: 0 })

    const page = await service.listMembers(admin.id, {
      sort: 'joinedAt',
      order: 'desc',
      page: 1,
      pageSize: 100
    })
    expect(page.items.some((item) => item.memberId === member.id)).toBe(true)
    expect(page.items.some((item) => item.memberId === admin.id)).toBe(false)
  })

  it('refuses a caller that is not an active administrator', async () => {
    const member = await createUser('actor')
    await expect(repository.getMember(member.id, member.id)).rejects.toThrow()
    await expect(
      repository.setRestriction({
        actorId: member.id,
        memberId: member.id,
        expectedRowVersion: 1,
        reason: '스스로 제한'
      })
    ).rejects.toThrow()
    await expect(restrictionReader.isRestricted(member.id)).resolves.toBe(false)
  })

  it('restricts and releases with rowVersion checks', async () => {
    const member = await createUser('restrict')

    const restricted = await service.restrict({
      actorId: admin.id,
      memberId: member.id,
      expectedRowVersion: 1,
      reason: '반복된 부적절 제보'
    })
    expect(restricted).toMatchObject({
      status: 'RESTRICTED',
      restrictionReason: '반복된 부적절 제보',
      rowVersion: 2
    })
    expect(restricted.restrictedAt).not.toBeNull()
    await expect(restrictionReader.isRestricted(member.id)).resolves.toBe(true)

    await expect(
      service.restrict({
        actorId: admin.id,
        memberId: member.id,
        expectedRowVersion: 1,
        reason: '중복'
      })
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    await expect(
      service.restrict({
        actorId: admin.id,
        memberId: member.id,
        expectedRowVersion: 2,
        reason: '중복'
      })
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })

    const released = await service.releaseRestriction({
      actorId: admin.id,
      memberId: member.id,
      expectedRowVersion: 2
    })
    expect(released).toMatchObject({
      status: 'ACTIVE',
      restrictedAt: null,
      restrictionReason: null,
      rowVersion: 3
    })
    await expect(restrictionReader.isRestricted(member.id)).resolves.toBe(false)
    await expect(
      service.releaseRestriction({
        actorId: admin.id,
        memberId: member.id,
        expectedRowVersion: 3
      })
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })

    const statusSorted = await service.listMembers(admin.id, {
      sort: 'status',
      order: 'desc',
      page: 1,
      pageSize: 25
    })
    expect(statusSorted.items.length).toBeGreaterThan(0)
  })

  it('reports unknown or administrator targets as not found', async () => {
    for (const memberId of [randomUUID(), admin.id]) {
      await expect(service.getMember(admin.id, memberId)).rejects.toMatchObject(
        { code: 'RESOURCE_NOT_FOUND' }
      )
      await expect(
        service.restrict({
          actorId: admin.id,
          memberId,
          expectedRowVersion: 1,
          reason: '없음'
        })
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    }
  })

  it('removes restriction history with an erased member', async () => {
    const member = await createUser('erased')
    await service.restrict({
      actorId: admin.id,
      memberId: member.id,
      expectedRowVersion: 1,
      reason: '탈퇴 전 제한'
    })
    await eraseUser(member.id)

    const events =
      await fixtureDatabase.client.userAccountRestrictionEvent.count({
        where: { userId: member.id }
      })
    expect(events).toBe(0)
  })
})

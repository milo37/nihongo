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
import { createPrismaUserReportRepository } from './userReportRepository.js'
import { createUserReportService } from './userReportService.js'
import { eraseTestUser } from '../db/fixtures/accountErasure.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const schema = getPostgresSchema(environment.DATABASE_URL)
if (!schema)
  throw new Error('User report integration test schema가 필요합니다.')

const isCurrentSourceIntegration =
  process.env.API_INTEGRATION_CURRENT_SOURCE === '1'
const fixtureDatabaseUrl = process.env.API_INTEGRATION_FIXTURE_DATABASE_URL
const erasureWorkerDatabaseUrl = process.env.TEST_API_ERASURE_DATABASE_URL
if (
  isCurrentSourceIntegration &&
  (!fixtureDatabaseUrl || !erasureWorkerDatabaseUrl)
) {
  throw new Error(
    'User report integration requires fixture and erasure databases.'
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
const createdReportIds = new Set<string>()

const repository = createPrismaUserReportRepository(database.client)
const service = createUserReportService(repository)

const createUser = async (label: string): Promise<string> => {
  const id = randomUUID()
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        id,
        email: `user-report-${randomUUID()}@example.test`,
        emailVerified: true,
        name: `User report ${label}`
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
    await eraseTestUser(database.client, userId)
  } else {
    await client.query('DELETE FROM "User" WHERE "id" = $1', [userId])
  }
  createdUserIds.delete(userId)
}

const appError = (location: string) =>
  ({
    kind: 'APP_ERROR',
    location,
    description: `화면이 멈춥니다.\n${location}`
  }) as const

let publishedVersion: { questionId: string; questionVersionId: string }

beforeAll(async () => {
  await client.connect()
  if (erasureWorkerClient) {
    await erasureWorkerClient.connect()
    await erasureWorkerClient.query(`SET ROLE "nihongo_app"`)
  }
  const result = await client.query<{
    questionId: string
    questionVersionId: string
  }>(
    `SELECT version."questionId", version."id" AS "questionVersionId"
     FROM "QuestionVersion" AS version
     WHERE version."status" = 'PUBLISHED'
     ORDER BY version."id" LIMIT 1`
  )
  const row = result.rows[0]
  if (!row) throw new Error('A published question version is required.')
  publishedVersion = row
})

afterAll(async () => {
  for (const userId of createdUserIds) {
    await eraseUser(userId).catch(() => undefined)
  }
  if (createdReportIds.size > 0) {
    // Reports outlive erasure; remove them with the fixture owner.
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

describe('Unified user reports TEST database integration', () => {
  it('stores learner reports and lists them for the learner and admins', async () => {
    const reporter = await createUser('learner')
    const first = await service.createReport(reporter, appError('/study/1'))
    const second = await service.createReport(reporter, appError('/study/2'))
    createdReportIds.add(first.reportId).add(second.reportId)

    const mine = await service.listMyReports(reporter, {
      page: 1,
      pageSize: 20
    })
    expect(mine.total).toBe(2)
    expect(mine.items.map(({ reportId }) => reportId)).toEqual([
      second.reportId,
      first.reportId
    ])
    expect(mine.items[0]).not.toHaveProperty('internalNote')

    const detail = await service.getAdminReport(first.reportId)
    expect(detail).toMatchObject({
      kind: 'APP_ERROR',
      status: 'RECEIVED',
      location: '/study/1',
      reporterMemberId: reporter,
      questionId: null,
      rowVersion: 1
    })
    const page = await service.listAdminReports({
      status: 'RECEIVED',
      kind: 'APP_ERROR',
      page: 1,
      pageSize: 100
    })
    const summary = page.items.find(
      ({ reportId }) => reportId === first.reportId
    )
    expect(summary?.descriptionPreview).toBe('화면이 멈춥니다. /study/1')
  })

  it('accepts one open question report per learner and version', async () => {
    const reporter = await createUser('question')
    const request = {
      kind: 'QUESTION',
      location: '/practice',
      ...publishedVersion,
      description: '정답이 두 개로 보입니다.'
    } as const
    const created = await service.createReport(reporter, request)
    createdReportIds.add(created.reportId)
    await expect(service.createReport(reporter, request)).rejects.toMatchObject(
      { code: 'QUESTION_REPORT_DUPLICATE' }
    )
    await expect(
      service.createReport(reporter, {
        ...request,
        questionVersionId: randomUUID()
      })
    ).rejects.toMatchObject({ code: 'QUESTION_NOT_AVAILABLE' })
  })

  it('applies note, reply and close commands with optimistic versions', async () => {
    const reporter = await createUser('commands')
    const { reportId } = await service.createReport(
      reporter,
      appError('/review')
    )
    createdReportIds.add(reportId)

    const noted = await service.saveNote(reportId, {
      expectedRowVersion: 1,
      internalNote: '재현 확인 중'
    })
    expect(noted).toMatchObject({ internalNote: '재현 확인 중', rowVersion: 2 })
    await expect(
      service.close(reportId, { expectedRowVersion: 1 })
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })

    const answered = await service.replyAndClose(reportId, {
      expectedRowVersion: 2,
      reporterReply: '수정했습니다. 감사합니다.'
    })
    expect(answered).toMatchObject({
      status: 'ANSWERED',
      reporterReply: '수정했습니다. 감사합니다.',
      internalNote: '재현 확인 중',
      rowVersion: 3
    })
    expect(answered.closedAt).toBe(answered.repliedAt)
    await expect(
      service.saveNote(reportId, { expectedRowVersion: 3, internalNote: '' })
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
    await expect(
      service.close(randomUUID(), { expectedRowVersion: 1 })
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })

    const mine = await service.listMyReports(reporter, {
      page: 1,
      pageSize: 20
    })
    expect(mine.items[0]).toMatchObject({
      status: 'ANSWERED',
      reporterReply: '수정했습니다. 감사합니다.'
    })

    const other = await service.createReport(reporter, appError('/close'))
    createdReportIds.add(other.reportId)
    const closed = await service.close(other.reportId, {
      expectedRowVersion: 1,
      internalNote: ''
    })
    expect(closed).toMatchObject({
      status: 'CLOSED',
      reporterReply: null,
      internalNote: null
    })
  })

  it('keeps reports and detaches the reporter when the account is erased', async () => {
    const reporter = await createUser('erased')
    const { reportId } = await service.createReport(
      reporter,
      appError('/erase')
    )
    createdReportIds.add(reportId)
    await eraseUser(reporter)
    // Same policy as QuestionReport: keep the row, drop the reporter's text.
    expect(await service.getAdminReport(reportId)).toMatchObject({
      reportId,
      reporterMemberId: null,
      description: '탈퇴한 회원의 제보 내용은 삭제되었습니다.',
      location: '/erase',
      rowVersion: 2
    })
  })
})

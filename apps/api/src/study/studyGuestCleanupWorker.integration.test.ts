import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import {
  createDatabaseRuntime,
  createRoleDatabaseRuntime
} from '../db/database.js'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { verifyStudyGuestCleanupRole } from './studyGuestCleanupRole.js'
import { createPrismaStudyDraftRepository } from './studyDraftRepository.js'
import { createPrismaStudyResultRetryRepository } from './studyResultRetryRepository.js'
import { createStudyResultRetryService } from './studyResultRetryService.js'
import { createPrismaStudySessionRepository } from './studySessionRepository.js'
import { createPrismaStudySubmissionRepository } from './studySubmissionRepository.js'
import { createStudySubmissionService } from './studySubmissionService.js'

const fixtureUrl = process.env.GUEST_CLEANUP_FIXTURE_DATABASE_URL
const workerUrl = process.env.GUEST_CLEANUP_DATABASE_URL
const applicationUrl = process.env.PHASE7_RUNTIME_DATABASE_URL
const erasureUrl = process.env.PHASE7_API_ERASURE_DATABASE_URL
if (
  !fixtureUrl ||
  !workerUrl ||
  !applicationUrl ||
  !erasureUrl ||
  process.env.GUEST_CLEANUP_TEST_ISOLATED !== 'yes'
) {
  throw new Error('Guest cleanup requires an explicitly isolated test target.')
}
for (const databaseUrl of [fixtureUrl, workerUrl, applicationUrl, erasureUrl]) {
  assertSafeTestDatabase({
    nodeEnvironment: process.env.NODE_ENV,
    databaseUrl,
    productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
  })
  const parsed = new URL(databaseUrl)
  if (
    parsed.pathname !== '/nihongo_jlp534_test' ||
    !/^jlp534_[a-z0-9_]+$/.test(getPostgresSchema(databaseUrl) ?? '')
  ) {
    throw new Error('Guest cleanup requires its dedicated database and schema.')
  }
}
const identity = (url: string) => {
  const parsed = new URL(url)
  return [
    parsed.hostname,
    parsed.port || '5432',
    parsed.pathname,
    getPostgresSchema(url)
  ].join('|')
}
if (
  identity(fixtureUrl) !== identity(workerUrl) ||
  identity(fixtureUrl) !== identity(applicationUrl) ||
  identity(fixtureUrl) !== identity(erasureUrl)
) {
  throw new Error('Guest cleanup test connections do not share one target.')
}

const fixture = new Client({
  connectionString: fixtureUrl,
  options: createPostgresStartupOptions(getPostgresSchema(fixtureUrl))
})
const worker = createRoleDatabaseRuntime(
  workerUrl,
  'nihongo_guest_cleanup_worker'
)
const application = createRoleDatabaseRuntime(applicationUrl, 'nihongo_app')
const erasure = new Client({
  connectionString: erasureUrl,
  options: createPostgresStartupOptions(
    getPostgresSchema(erasureUrl),
    'nihongo_erasure_worker'
  )
})
const fixtureDatabase = createDatabaseRuntime(fixtureUrl)
const ids: string[] = []
const userIds: string[] = []
const guestIds: string[] = []

const createFixtureUser = async (name: string): Promise<string> => {
  const userId = randomUUID()
  await fixtureDatabase.client.$transaction(async (transaction) => {
    await transaction.user.create({
      data: {
        id: userId,
        name,
        email: `${userId}@example.test`,
        emailVerified: true
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
  userIds.push(userId)
  return userId
}

beforeAll(async () => {
  await fixture.connect()
  await erasure.connect()
  await verifyStudyGuestCleanupRole(worker.client)
})

afterAll(async () => {
  if (ids.length > 0)
    await fixture.query(
      'DELETE FROM "RateLimit" WHERE "id" = ANY($1::uuid[])',
      [ids]
    )
  for (const userId of userIds)
    await erasure.query('SELECT "phase7_erase_user"($1, \'TEST\')', [userId])
  if (guestIds.length > 0)
    await fixtureDatabase.client.guestPrincipal.deleteMany({
      where: { id: { in: guestIds } }
    })
  await fixture.end()
  await erasure.end()
  await fixtureDatabase.disconnect()
  await worker.disconnect()
  await application.disconnect()
})

describe('guest cleanup worker boundary', () => {
  it('keeps guest and member data through preview and bounded cleanup across the retention threshold', async () => {
    const clock = await fixture.query<{ now: Date }>(
      'SELECT clock_timestamp() AS now'
    )
    const now = clock.rows[0]?.now
    if (!now) throw new Error('Missing database clock')
    const hour = 60 * 60 * 1_000
    const day = 24 * hour
    const cutoff = now.getTime() - 7 * day
    const sessions = createPrismaStudySessionRepository(application.client)
    const createGuestSession = async (
      expiresAt: Date,
      startedAt = new Date(expiresAt.getTime() - hour)
    ) => {
      const guest = createGuestPrincipalService({
        client: application.client,
        secret: 'guest-cleanup-test-secret-at-least-32-characters'
      }).prepareCredential()
      await fixtureDatabase.client.guestPrincipal.create({
        data: {
          id: guest.id,
          tokenDigest: guest.tokenDigest,
          createdAt: startedAt,
          lastSeenAt: startedAt,
          expiresAt: new Date(startedAt.getTime() + 7 * day)
        }
      })
      guestIds.push(guest.id)
      const owner = {
        kind: 'GUEST' as const,
        guestPrincipalId: guest.id,
        tokenDigest: guest.tokenDigest
      }
      const session = (
        await sessions.createRandom({
          owner,
          level: 'N5',
          subject: 'VOCABULARY',
          requestedCount: 1,
          startedAt,
          expiresAt,
          practiceContractVersion: 2
        })
      ).session
      return { session, owner }
    }
    const { session: before } = await createGuestSession(
      new Date(cutoff + hour)
    )
    const { session: boundary } = await createGuestSession(new Date(cutoff))
    const { session: after } = await createGuestSession(new Date(cutoff - hour))
    const { session: active, owner } = await createGuestSession(
      new Date(now.getTime() + day),
      new Date(now.getTime() - hour)
    )

    const draft = createPrismaStudyDraftRepository(application.client)
    const activeKey = randomUUID()
    const activeBody = {
      expectedRevision: 0,
      currentOrdinal: 1,
      answers: active.questions.map(({ sessionQuestionId }) => ({
        studySessionQuestionId: sessionQuestionId,
        selectedOptionId: null,
        elapsedSec: 0
      }))
    }
    await draft.saveAtomic({
      sessionId: active.id,
      owner,
      idempotencyKey: activeKey,
      observedAt: new Date(now.getTime()),
      body: activeBody
    })
    const userId = await createFixtureUser('Cleanup member')
    const member = (
      await sessions.createRandom({
        owner: { kind: 'USER', userId },
        level: 'N5',
        subject: 'VOCABULARY',
        requestedCount: 1,
        startedAt: new Date(cutoff - 2 * hour),
        expiresAt: new Date(cutoff - hour),
        practiceContractVersion: 2
      })
    ).session
    await expect(
      fixtureDatabase.client.studySession.update({
        where: { id: before.id },
        data: { userId, guestPrincipalId: null }
      })
    ).rejects.toThrow()

    const sessionIds = [before.id, boundary.id, after.id, active.id, member.id]
    const snapshot = async () =>
      await fixtureDatabase.client.studySession.findMany({
        where: { id: { in: sessionIds } },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          userId: true,
          guestPrincipalId: true,
          status: true,
          draft: {
            select: {
              revision: true,
              answers: {
                orderBy: { studySessionQuestionId: 'asc' },
                select: {
                  studySessionQuestionId: true,
                  selectedOptionId: true,
                  elapsedSec: true
                }
              }
            }
          }
        }
      })
    const original = await snapshot()
    const originalGuests = await fixtureDatabase.client.guestPrincipal.findMany(
      {
        where: { id: { in: guestIds } },
        orderBy: { id: 'asc' }
      }
    )
    const originalReplay =
      await fixtureDatabase.client.idempotencyRecord.findMany({
        where: { idempotencyKey: activeKey }
      })
    await worker.client
      .$queryRaw`SELECT * FROM "phase7_guest_cleanup_batch"('TEST', 1, true)`
    expect(await snapshot()).toEqual(original)
    expect(
      await fixtureDatabase.client.guestPrincipal.findMany({
        where: { id: { in: guestIds } },
        orderBy: { id: 'asc' }
      })
    ).toEqual(originalGuests)
    expect(
      await fixtureDatabase.client.idempotencyRecord.findMany({
        where: { idempotencyKey: activeKey }
      })
    ).toEqual(originalReplay)
    const first = await worker.client.$queryRaw<
      { deletedCount: bigint; hasMore: boolean }[]
    >`
      SELECT "deletedCount", "hasMore" FROM "phase7_guest_cleanup_batch"('TEST', 1, false)`
    expect(first[0]).toEqual({ deletedCount: 1n, hasMore: true })
    const interrupted = await snapshot()
    expect(
      interrupted.filter(
        ({ id, draft: row }) =>
          [boundary.id, after.id].includes(id) && row === null
      )
    ).toHaveLength(1)
    const resumed = await worker.client.$queryRaw<{ deletedCount: bigint }[]>`
      SELECT "deletedCount" FROM "phase7_guest_cleanup_batch"('TEST', 1, false)`
    expect(resumed[0]?.deletedCount).toBe(1n)
    const remaining = await snapshot()
    for (const id of [boundary.id, after.id]) {
      expect(remaining.find((session) => session.id === id)).toMatchObject({
        status: 'EXPIRED',
        draft: null
      })
    }
    for (const id of [before.id, active.id, member.id]) {
      expect(remaining.find((session) => session.id === id)).toEqual(
        original.find((session) => session.id === id)
      )
    }
    expect(
      await fixtureDatabase.client.guestPrincipal.findUnique({
        where: { id: owner.guestPrincipalId }
      })
    ).not.toBeNull()
    await expect(
      draft.saveAtomic({
        sessionId: active.id,
        owner,
        idempotencyKey: activeKey,
        observedAt: new Date(now.getTime() + 1),
        body: activeBody
      })
    ).resolves.toMatchObject({ replayed: true })
  })

  it('keeps a stale guest draft while an unfinished request holds its session', async () => {
    const clock = await fixture.query<{ now: Date }>(
      'SELECT clock_timestamp() AS now'
    )
    const now = clock.rows[0]?.now
    if (!now) throw new Error('Missing database clock')
    const hour = 60 * 60 * 1_000
    const day = 24 * hour
    const startedAt = new Date(now.getTime() - 8 * day - hour)
    const guest = createGuestPrincipalService({
      client: application.client,
      secret: 'guest-cleanup-test-secret-at-least-32-characters'
    }).prepareCredential()
    await fixtureDatabase.client.guestPrincipal.create({
      data: {
        id: guest.id,
        tokenDigest: guest.tokenDigest,
        createdAt: startedAt,
        lastSeenAt: startedAt,
        expiresAt: new Date(startedAt.getTime() + 7 * day)
      }
    })
    guestIds.push(guest.id)
    const session = (
      await createPrismaStudySessionRepository(application.client).createRandom(
        {
          owner: {
            kind: 'GUEST',
            guestPrincipalId: guest.id,
            tokenDigest: guest.tokenDigest
          },
          level: 'N5',
          subject: 'VOCABULARY',
          requestedCount: 1,
          startedAt,
          expiresAt: new Date(now.getTime() - 8 * day),
          practiceContractVersion: 2
        }
      )
    ).session
    const pendingId = randomUUID()
    await fixture.query('BEGIN')
    try {
      await fixture.query(
        'SELECT "id" FROM "StudySession" WHERE "id" = $1 FOR UPDATE',
        [session.id]
      )
      await fixture.query(
        `INSERT INTO "IdempotencyRecord"
          ("id", "principalType", "guestPrincipalId", "operation", "contractVersion", "idempotencyKey", "studySessionId", "requestHash", "state", "createdAt")
         VALUES ($1, 'GUEST', $2, 'STUDY_DRAFT_SAVE', 2, $3, $4, $5, 'PROCESSING', clock_timestamp())`,
        [pendingId, guest.id, randomUUID(), session.id, 'b'.repeat(64)]
      )
      const observer = new Client({
        connectionString: applicationUrl,
        options: createPostgresStartupOptions(
          getPostgresSchema(applicationUrl),
          'nihongo_app'
        )
      })
      await observer.connect()
      try {
        await observer.query('BEGIN')
        await expect(
          observer.query(
            'SELECT "id" FROM "StudySession" WHERE "id" = $1 FOR UPDATE NOWAIT',
            [session.id]
          )
        ).rejects.toMatchObject({ code: '55P03' })
      } finally {
        await observer.query('ROLLBACK')
        await observer.end()
      }
      await worker.client
        .$queryRaw`SELECT * FROM "phase7_guest_cleanup_batch"('TEST', 100, false)`
      const row = await fixture.query<{
        state: string
        expiresAt: Date | null
      }>(
        'SELECT "state", "expiresAt" FROM "IdempotencyRecord" WHERE "id" = $1',
        [pendingId]
      )
      expect(row.rows).toEqual([{ state: 'PROCESSING', expiresAt: null }])
      expect(
        await fixtureDatabase.client.studySession.findUnique({
          where: { id: session.id },
          select: { status: true, draft: { select: { revision: true } } }
        })
      ).toEqual({ status: 'IN_PROGRESS', draft: { revision: 0 } })
    } finally {
      await fixture.query('ROLLBACK')
    }
    await worker.client
      .$queryRaw`SELECT * FROM "phase7_guest_cleanup_batch"('TEST', 1, false)`
    expect(
      await fixtureDatabase.client.studySession.findUnique({
        where: { id: session.id },
        select: { status: true, draft: { select: { revision: true } } }
      })
    ).toEqual({ status: 'EXPIRED', draft: null })
  })

  it('preserves member learning and active replay and retry references', async () => {
    const userId = await createFixtureUser('Cleanup fixture')
    const owner = { kind: 'USER' as const, userId }
    const now = Date.now()
    const hour = 60 * 60 * 1_000
    const startedAt = new Date(now - 80 * hour)
    const expiresAt = new Date(now + 24 * hour)
    const sessionRepository = createPrismaStudySessionRepository(
      application.client
    )
    const createSession = async () =>
      (
        await sessionRepository.createRandom({
          owner,
          level: 'N5',
          subject: 'VOCABULARY',
          requestedCount: 1,
          startedAt,
          expiresAt,
          practiceContractVersion: 2
        })
      ).session

    const draftSession = await createSession()
    const draftRepository = createPrismaStudyDraftRepository(application.client)
    const body = {
      expectedRevision: 0,
      currentOrdinal: 1,
      answers: draftSession.questions.map(({ sessionQuestionId }) => ({
        studySessionQuestionId: sessionQuestionId,
        selectedOptionId: null,
        elapsedSec: 0
      }))
    }
    const expiredKey = randomUUID()
    const activeKey = randomUUID()
    await draftRepository.saveAtomic({
      sessionId: draftSession.id,
      owner,
      idempotencyKey: expiredKey,
      observedAt: new Date(now - 72 * hour),
      body
    })
    const currentBody = { ...body, expectedRevision: 1 }
    await draftRepository.saveAtomic({
      sessionId: draftSession.id,
      owner,
      idempotencyKey: activeKey,
      observedAt: new Date(now - hour),
      body: currentBody
    })

    const submitted = await createSession()
    await createStudySubmissionService(
      createPrismaStudySubmissionRepository(application.client),
      () => new Date(now - 72 * hour)
    ).submit(
      submitted.id,
      randomUUID(),
      {
        answers: submitted.questions.map(({ sessionQuestionId }) => ({
          studySessionQuestionId: sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        })),
        durationSec: 0,
        expectedDraftRevision: 0
      },
      owner,
      2
    )
    const retryKey = randomUUID()
    const retryService = createStudyResultRetryService(
      createPrismaStudyResultRetryRepository(application.client),
      () => new Date(now - hour)
    )
    const retry = await retryService.create(submitted.id, retryKey, owner)

    const before = await fixtureDatabase.client.idempotencyRecord.findMany({
      where: { userId },
      select: {
        id: true,
        idempotencyKey: true,
        operation: true,
        studySessionId: true
      }
    })
    const expired = before.find(
      (record) => record.idempotencyKey === expiredKey
    )
    const active = before.find((record) => record.idempotencyKey === activeKey)
    const protectedSubmission = before.find(
      (record) => record.operation === 'STUDY_SUBMIT'
    )
    expect(expired).toBeDefined()
    expect(active).toBeDefined()
    expect(protectedSubmission).toBeDefined()

    await worker.client
      .$queryRaw`SELECT * FROM "phase7_guest_cleanup_batch"('TEST', 100, false)`
    const after = await fixtureDatabase.client.idempotencyRecord.findMany({
      where: { userId },
      select: { id: true }
    })
    expect(after.map(({ id }) => id)).not.toContain(expired?.id)
    expect(after.map(({ id }) => id)).toContain(active?.id)
    expect(after.map(({ id }) => id)).toContain(protectedSubmission?.id)
    await expect(
      draftRepository.saveAtomic({
        sessionId: draftSession.id,
        owner,
        idempotencyKey: activeKey,
        observedAt: new Date(now),
        body: currentBody
      })
    ).resolves.toMatchObject({ replayed: true })
    await expect(
      retryService.create(submitted.id, retryKey, owner)
    ).resolves.toMatchObject({ replayed: true })
    expect(
      await fixtureDatabase.client.studySession.findMany({
        where: {
          id: { in: [draftSession.id, submitted.id, retry.response.session.id] }
        },
        select: { id: true }
      })
    ).toHaveLength(3)
    expect(
      await fixtureDatabase.client.studyDraft.findUnique({
        where: { studySessionId: draftSession.id }
      })
    ).not.toBeNull()
    expect(
      await fixtureDatabase.client.studyResult.findUnique({
        where: { studySessionId: submitted.id }
      })
    ).not.toBeNull()

    const pending = await createSession()
    const pendingId = randomUUID()
    await fixture.query('BEGIN')
    try {
      await fixture.query(
        `INSERT INTO "IdempotencyRecord"
          ("id", "principalType", "userId", "operation", "contractVersion", "idempotencyKey", "studySessionId", "requestHash", "state", "createdAt")
         VALUES ($1, 'USER', $2, 'STUDY_DRAFT_SAVE', 2, $3, $4, $5, 'PROCESSING', clock_timestamp())`,
        [pendingId, userId, randomUUID(), pending.id, 'a'.repeat(64)]
      )
      await worker.client
        .$queryRaw`SELECT * FROM "phase7_guest_cleanup_batch"('TEST', 100, false)`
      const rows = await fixture.query<{
        state: string
        expiresAt: Date | null
      }>(
        'SELECT "state", "expiresAt" FROM "IdempotencyRecord" WHERE "id" = $1',
        [pendingId]
      )
      expect(rows.rows).toEqual([{ state: 'PROCESSING', expiresAt: null }])
    } finally {
      await fixture.query('ROLLBACK')
    }
  })

  it('skips a locked first candidate and processes the next with batch size one', async () => {
    const [firstId, nextId] = [randomUUID(), randomUUID()].sort()
    if (!firstId || !nextId) throw new Error('Missing fixture IDs')
    ids.push(firstId, nextId)
    const digest = randomUUID().replaceAll('-', '').padEnd(64, 'b')
    await fixture.query(
      `INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest")
       VALUES ($1, $2, 1, 0), ($3, $4, 1, 0)`,
      [
        firstId,
        `application:study-submit:${digest}`,
        nextId,
        `application:study-create:${digest}`
      ]
    )
    const preview = await worker.client.$queryRaw<{ eligibleCount: bigint }[]>`
      SELECT "eligibleCount" FROM "phase7_guest_cleanup_batch"('TEST', 1, true)`
    expect(preview[0]?.eligibleCount).toBe(2n)

    await fixture.query('BEGIN')
    try {
      await fixture.query(
        'SELECT "id" FROM "RateLimit" WHERE "id" = $1 FOR UPDATE',
        [firstId]
      )
      const result = await worker.client.$queryRaw<
        { deletedCount: bigint; eligibleCount: bigint; hasMore: boolean }[]
      >`SELECT * FROM "phase7_guest_cleanup_batch"('TEST', 1, false)`
      expect(result[0]).toEqual({
        deletedCount: 1n,
        eligibleCount: 1n,
        hasMore: true
      })
      const remaining = await fixture.query<{ id: string }>(
        'SELECT "id" FROM "RateLimit" WHERE "id" = ANY($1::uuid[])',
        [[firstId, nextId]]
      )
      expect(remaining.rows).toEqual([{ id: firstId }])
    } finally {
      await fixture.query('ROLLBACK')
    }
    const resumed = await worker.client.$queryRaw<
      { deletedCount: bigint; eligibleCount: bigint; hasMore: boolean }[]
    >`SELECT * FROM "phase7_guest_cleanup_batch"('TEST', 1, false)`
    expect(resumed[0]).toEqual({
      deletedCount: 1n,
      eligibleCount: 0n,
      hasMore: false
    })
  })

  it('previews without changes and removes only known expired rate keys', async () => {
    const clock = await fixture.query<{ now_ms: string }>(
      'SELECT floor(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS now_ms'
    )
    const now = BigInt(clock.rows[0]?.now_ms ?? '0')
    const digest = randomUUID().replaceAll('-', '').padEnd(64, 'a')
    const oldId = randomUUID()
    const recentId = randomUUID()
    const unknownId = randomUUID()
    ids.push(oldId, recentId, unknownId)
    await fixture.query(
      'INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest") VALUES ($1,$2,1,$3),($4,$5,1,$6),($7,$8,1,$9)',
      [
        oldId,
        `application:study-submit:${digest}`,
        (now - 604_860_000n - 5_000n).toString(),
        recentId,
        `application:phase7:REPORT_VERSION:VERSION:${digest}`,
        (now - 604_860_000n).toString(),
        unknownId,
        `unknown:${digest}`,
        (now - 700_000_000n).toString()
      ]
    )

    const preview = await worker.client.$queryRaw<
      { deletedCount: bigint; eligibleCount: bigint }[]
    >`
      SELECT "deletedCount", "eligibleCount" FROM "phase7_guest_cleanup_batch"('TEST', 10, true)`
    expect(preview[0]?.deletedCount).toBe(0n)
    expect(preview[0]?.eligibleCount).toBeGreaterThanOrEqual(1n)
    expect(
      (
        await fixture.query(
          'SELECT "id" FROM "RateLimit" WHERE "id" = ANY($1::uuid[])',
          [ids]
        )
      ).rowCount
    ).toBe(3)

    await expect(
      application.client
        .$queryRaw`SELECT * FROM "phase7_guest_cleanup_batch"('TEST', 10, false)`
    ).rejects.toThrow()
    await expect(
      worker.client
        .$executeRaw`DELETE FROM "RateLimit" WHERE "id" = ${oldId}::uuid`
    ).rejects.toThrow()
    await expect(
      worker.client
        .$queryRaw`SELECT * FROM "phase7_guest_cleanup_batch"('PRODUCTION', 10, false)`
    ).rejects.toThrow()
    await fixture.query(
      "SELECT pg_advisory_lock(hashtext('nihongo_guest_cleanup'))"
    )
    try {
      await expect(
        worker.client
          .$queryRaw`SELECT * FROM "phase7_guest_cleanup_batch"('TEST', 10, false)`
      ).rejects.toThrow()
      expect(
        (
          await fixture.query('SELECT 1 FROM "RateLimit" WHERE "id" = $1', [
            oldId
          ])
        ).rowCount
      ).toBe(1)
    } finally {
      await fixture.query(
        "SELECT pg_advisory_unlock(hashtext('nihongo_guest_cleanup'))"
      )
    }
    await worker.client
      .$queryRaw`SELECT * FROM "phase7_guest_cleanup_batch"('TEST', 10, false)`
    const remaining = await fixture.query<{ id: string }>(
      'SELECT "id" FROM "RateLimit" WHERE "id" = ANY($1::uuid[])',
      [ids]
    )
    expect(remaining.rows.map(({ id }) => id).sort()).toEqual(
      [recentId, unknownId].sort()
    )
    await worker.client
      .$queryRaw`SELECT * FROM "phase7_guest_cleanup_batch"('TEST', 10, false)`
    expect(
      (
        await fixture.query(
          'SELECT "id" FROM "RateLimit" WHERE "id" = ANY($1::uuid[])',
          [ids]
        )
      ).rowCount
    ).toBe(2)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createStudySessionService } from './studySessionService.js'
import type {
  StudySessionRecord,
  StudySessionRepository
} from './studySessionRepository.js'
import { createStudySubmissionService } from './studySubmissionService.js'
import type { StudySubmissionRepository } from './studySubmissionRepository.js'

const owner = { kind: 'USER', userId: 'user' } as const
const input = {
  level: 'N5',
  subject: 'VOCABULARY',
  mode: 'RANDOM',
  count: 1
} as const
const timestamp = new Date('2026-01-01T00:00:00.000Z')
const session: StudySessionRecord = {
  id: 'session',
  userId: 'user',
  guestPrincipalId: null,
  level: 'N5',
  subject: 'VOCABULARY',
  mode: 'RANDOM',
  status: 'IN_PROGRESS',
  requestedCount: 1,
  actualCount: 1,
  usedFallback: false,
  fallbackReason: null,
  startedAt: timestamp,
  expiresAt: timestamp,
  submittedAt: null,
  durationSec: null,
  practiceContractVersion: 2,
  questions: []
}

describe('practice contract retirement', () => {
  it('defaults creation to v2 and rejects explicit v1 before repository writes', async () => {
    const create = vi.fn(async () => ({ session, issuedGuestCredential: null }))
    const repository: StudySessionRepository = {
      create,
      createRandom: vi.fn(),
      findOwnedById: vi.fn()
    }
    const service = createStudySessionService(repository, () => timestamp)
    const result = await service.create(input, owner)
    expect(result.practiceContractVersion).toBe(2)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ practiceContractVersion: 2 })
    )
    await expect(service.create(input, owner, 1)).rejects.toMatchObject({
      code: 'PRACTICE_CONTRACT_VERSION_MISMATCH'
    })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('rejects an owned old session and preserves the not-found owner boundary', async () => {
    const findOwnedById = vi.fn<StudySessionRepository['findOwnedById']>()
    const service = createStudySessionService({
      create: vi.fn(),
      createRandom: vi.fn(),
      findOwnedById
    })
    findOwnedById.mockResolvedValueOnce({
      ...session,
      practiceContractVersion: 1
    })
    await expect(service.get('session', owner)).rejects.toMatchObject({
      code: 'PRACTICE_CONTRACT_VERSION_MISMATCH'
    })
    findOwnedById.mockResolvedValueOnce(null)
    await expect(service.get('session', owner)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND'
    })
  })

  it('rejects a v1 session before a v2 submission can replay an old key', async () => {
    const submitAtomic = vi.fn<StudySubmissionRepository['submitAtomic']>()
    const preloadOwned = vi.fn<StudySubmissionRepository['preloadOwned']>()
    preloadOwned.mockResolvedValueOnce({
      sessionId: 'session',
      status: 'IN_PROGRESS',
      expiresAt: timestamp,
      practiceContractVersion: 1,
      orderedSessionQuestions: []
    })
    const service = createStudySubmissionService({
      preloadOwned,
      submitAtomic,
      findOwnedResult: vi.fn()
    })
    await expect(
      service.submit(
        'session',
        'key',
        {
          answers: [],
          durationSec: 0,
          expectedDraftRevision: 0
        },
        owner
      )
    ).rejects.toMatchObject({ code: 'PRACTICE_CONTRACT_VERSION_MISMATCH' })
    expect(submitAtomic).not.toHaveBeenCalled()
  })

  it('rejects explicit v1 submissions before idempotency or repository access', async () => {
    const preloadOwned = vi.fn<StudySubmissionRepository['preloadOwned']>()
    const service = createStudySubmissionService({
      preloadOwned,
      findOwnedResult: vi.fn(),
      submitAtomic: vi.fn()
    })
    await expect(
      service.submit(
        'session',
        'key',
        { answers: [], durationSec: 0 },
        owner,
        1
      )
    ).rejects.toMatchObject({ code: 'PRACTICE_CONTRACT_VERSION_MISMATCH' })
    expect(preloadOwned).not.toHaveBeenCalled()
  })
})

describe('V1 retirement ownership checks', () => {
  it('rechecks the locked owner values without querying protected account tables', async () => {
    const sessionId = '12345678-1234-4234-8234-123456789abc'
    const userId = 'a2345678-1234-4234-8234-123456789abc'
    const queries: import('../generated/prisma/client.js').Prisma.Sql[] = []
    const results: unknown[][] = [
      [{ allowed: true }],
      [{ id: sessionId, userId, guestPrincipalId: null }],
      [],
      [{ id: sessionId }],
      [{ id: sessionId }],
      [{ deletedSessionCount: 1, deletedWrongNoteCount: 0 }]
    ]
    const transaction = {
      $queryRaw: async (
        query: import('../generated/prisma/client.js').Prisma.Sql
      ) => {
        queries.push(query)
        return results.shift()
      },
      $executeRaw: vi.fn(async () => 0),
      studySession: { updateMany: vi.fn(async () => ({ count: 1 })) }
    }
    const client = {
      $transaction: async (
        run: (value: typeof transaction) => Promise<unknown>
      ) => await run(transaction)
    } as unknown as import('../generated/prisma/client.js').PrismaClient
    const { createPrismaStudyV1RetirementRepository } = await import(
      './studyV1RetirementRepository.js'
    )
    await expect(
      createPrismaStudyV1RetirementRepository(client).retire([sessionId])
    ).resolves.toMatchObject({ deletedSessionCount: 1, expiredCount: 1 })
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(2)
    const lastQuery = queries.at(-2)
    expect(lastQuery?.sql).toContain('IS NOT DISTINCT FROM')
    expect(lastQuery?.sql).not.toContain('FROM "User"')
    expect(lastQuery?.sql).not.toContain('FROM "GuestPrincipal"')
    expect(lastQuery?.values).toContain(userId)
    expect(lastQuery?.values).toContain(null)
  })
})

describe('V1 retirement privilege boundary', () => {
  it('rejects a non-migration principal before assuming owner or touching data', async () => {
    const transaction = {
      $queryRaw: vi.fn(async () => [{ allowed: false }]),
      $executeRaw: vi.fn(async () => 0)
    }
    const client = {
      $transaction: async (
        run: (value: typeof transaction) => Promise<unknown>
      ) => await run(transaction)
    } as unknown as import('../generated/prisma/client.js').PrismaClient
    const { createPrismaStudyV1RetirementRepository } = await import(
      './studyV1RetirementRepository.js'
    )
    await expect(
      createPrismaStudyV1RetirementRepository(client).retire([
        '12345678-1234-4234-8234-123456789abc'
      ])
    ).rejects.toThrow(
      'V1 retirement requires the canonical TEST migration role.'
    )
    expect(transaction.$queryRaw).toHaveBeenCalledOnce()
    expect(transaction.$executeRaw).not.toHaveBeenCalled()
  })
})

describe('V1 retirement TEST target validation', () => {
  it('rejects production mode before opening a privileged connection', async () => {
    const { createStudyV1RetirementClient } = await import(
      './studyV1RetirementClient.js'
    )
    expect(() =>
      createStudyV1RetirementClient({
        nodeEnvironment: 'production',
        runtimeDatabaseUrl: undefined,
        migrationDatabaseUrl: undefined,
        productionDatabaseUrl: undefined
      })
    ).toThrow('Test database operations require NODE_ENV=test.')
  })

  it('rejects missing canonical migration and production-target proof', async () => {
    const { createStudyV1RetirementClient } = await import(
      './studyV1RetirementClient.js'
    )
    expect(() =>
      createStudyV1RetirementClient({
        nodeEnvironment: 'test',
        runtimeDatabaseUrl:
          'postgresql://user:password@127.0.0.1:56418/example_test?schema=public',
        migrationDatabaseUrl: undefined,
        productionDatabaseUrl: undefined
      })
    ).toThrow()
  })

  it('rejects a noncanonical migration login and a production-matching target', async () => {
    const { createStudyV1RetirementClient } = await import(
      './studyV1RetirementClient.js'
    )
    const runtime =
      'postgresql://app:fixture@127.0.0.1:56418/nihongo_test?schema=public'
    const input = {
      nodeEnvironment: 'test',
      runtimeDatabaseUrl: runtime,
      migrationDatabaseUrl:
        'postgresql://app:fixture@127.0.0.1:56418/nihongo_test?schema=public&options=-c%20role%3Dnihongo_phase7_migration',
      productionDatabaseUrl:
        'postgresql://app:fixture@127.0.0.1:56418/nihongo_production?schema=public'
    }
    expect(() => createStudyV1RetirementClient(input)).toThrow(
      'Phase 7 migration requires its exact canonical migration login.'
    )
    expect(() =>
      createStudyV1RetirementClient({
        ...input,
        productionDatabaseUrl: runtime
      })
    ).toThrow('Development and production DATABASE_URL must not target one DB.')
  })
})

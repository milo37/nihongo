import { describe, expect, it } from 'vitest'
import { PHASE7_RATE_LIMIT_STORAGE_KEY } from '@libs/storage'
import {
  Phase7RateLimitRepository,
  Phase7RateLimitRepositoryUnavailableError,
  type Phase7RateLimitStorage
} from '@mocks/repository/phase7RateLimitRepository'
import {
  createInMemoryPhase7MutationLease,
  Phase7MutationCoordinatorUnavailableError
} from '@mocks/repository/phase7MutationCoordinator'

const ACTOR_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1002'
const SECOND_ACTOR_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c1003'
const VERSION_ID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c2001'

const createStorage = (): Phase7RateLimitStorage & {
  readonly value: () => string | null
} => {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    getLatestItem: (key) => values.get(key) ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
    value: () => values.get(PHASE7_RATE_LIMIT_STORAGE_KEY) ?? null
  }
}

describe('Phase 7 shared fixed-window rate-limit repository', () => {
  it('serializes concurrent tabs, persists over reload, and shares a group across endpoints', async () => {
    const storage = createStorage()
    const lease = createInMemoryPhase7MutationLease()
    const options = { lease, now: () => 0, storage } as const
    const firstTab = new Phase7RateLimitRepository(options)
    const secondTab = new Phase7RateLimitRepository(options)
    const input = { actorId: ACTOR_ID, group: 'REPORT_ACTOR' } as const

    for (let count = 0; count < 4; count += 1) {
      await expect(firstTab.consume(input)).resolves.toEqual({
        retryAfterSeconds: null
      })
    }
    const concurrent = await Promise.all([
      firstTab.consume(input),
      secondTab.consume(input)
    ])
    expect(
      concurrent.map((result) => result.retryAfterSeconds).toSorted()
    ).toEqual([600, null])

    const afterReload = new Phase7RateLimitRepository(options)
    await expect(afterReload.consume(input)).resolves.toEqual({
      retryAfterSeconds: 600
    })
    await expect(
      afterReload.consume({
        actorId: SECOND_ACTOR_ID,
        group: 'REPORT_ACTOR'
      })
    ).resolves.toEqual({ retryAfterSeconds: 600 })
    await expect(
      afterReload.consume({ actorId: ACTOR_ID, group: 'ADMIN_EDIT' })
    ).resolves.toEqual({ retryAfterSeconds: null })
    await expect(
      afterReload.consume({ group: 'REPORT_VERSION', versionId: VERSION_ID })
    ).resolves.toEqual({ retryAfterSeconds: null })

    const persisted = JSON.parse(storage.value() ?? 'null') as {
      windows: Array<[string, { count: number }]>
    }
    expect(
      persisted.windows
        .filter(([key]) => key === `REPORT_ACTOR:actor:${ACTOR_ID}`)
        .map(([, window]) => window.count)
    ).toEqual([7])
    expect(
      persisted.windows
        .filter(([key]) => key === `REPORT_ACTOR:actor:${SECOND_ACTOR_ID}`)
        .map(([, window]) => window.count)
    ).toEqual([1])
    expect(
      persisted.windows
        .filter(([key]) => key === 'REPORT_ACTOR:ip:mock-client')
        .map(([, window]) => window.count)
    ).toEqual([8])
  })

  it('consumes actor and trusted-IP buckets atomically and returns the longest retry window', async () => {
    const backingStorage = createStorage()
    backingStorage.setItem(
      PHASE7_RATE_LIMIT_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        windows: [
          [
            `REPORT_ACTOR:actor:${ACTOR_ID}`,
            { count: 5, windowStartedAt: 100_000 }
          ],
          ['REPORT_ACTOR:ip:mock-client', { count: 5, windowStartedAt: 0 }]
        ]
      })
    )
    let leaseInvocationCount = 0
    let persistenceCount = 0
    const repository = new Phase7RateLimitRepository({
      lease: async <Result>(operation: () => Promise<Result>) => {
        leaseInvocationCount += 1
        return await operation()
      },
      now: () => 200_000,
      storage: {
        ...backingStorage,
        setItem: (key, value) => {
          persistenceCount += 1
          backingStorage.setItem(key, value)
        }
      }
    })

    await expect(
      repository.consume({ actorId: ACTOR_ID, group: 'REPORT_ACTOR' })
    ).resolves.toEqual({ retryAfterSeconds: 500 })
    expect(leaseInvocationCount).toBe(1)
    expect(persistenceCount).toBe(1)
    expect(JSON.parse(backingStorage.value() ?? 'null')).toEqual({
      schemaVersion: 1,
      windows: [
        [
          `REPORT_ACTOR:actor:${ACTOR_ID}`,
          { count: 6, windowStartedAt: 100_000 }
        ],
        ['REPORT_ACTOR:ip:mock-client', { count: 6, windowStartedAt: 0 }]
      ]
    })
  })

  it('keeps a non-sliding anchor and resets exactly at the fixed boundary', async () => {
    const storage = createStorage()
    const lease = createInMemoryPhase7MutationLease()
    let now = 0
    const repository = new Phase7RateLimitRepository({
      lease,
      now: () => now,
      storage
    })
    const input = { actorId: ACTOR_ID, group: 'REPORT_ACTOR' } as const
    await repository.primeForTesting(input, 5)

    now = 1
    await expect(repository.consume(input)).resolves.toEqual({
      retryAfterSeconds: 600
    })
    now = 599_999
    await expect(repository.consume(input)).resolves.toEqual({
      retryAfterSeconds: 1
    })
    now = 600_000
    await expect(repository.consume(input)).resolves.toEqual({
      retryAfterSeconds: null
    })
  })

  it('fails closed for corrupt state, rejected persistence, and unavailable locking', async () => {
    const corruptStorage = createStorage()
    corruptStorage.setItem(PHASE7_RATE_LIMIT_STORAGE_KEY, '{broken')
    const input = { actorId: ACTOR_ID, group: 'ADMIN_READ' } as const
    await expect(
      new Phase7RateLimitRepository({
        lease: createInMemoryPhase7MutationLease(),
        storage: corruptStorage
      }).consume(input)
    ).rejects.toBeInstanceOf(Phase7RateLimitRepositoryUnavailableError)

    const rejectedStorage: Phase7RateLimitStorage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => false
    }
    await expect(
      new Phase7RateLimitRepository({
        lease: createInMemoryPhase7MutationLease(),
        storage: rejectedStorage
      }).consume(input)
    ).rejects.toMatchObject({ retryAfterSeconds: 5 })

    await expect(
      new Phase7RateLimitRepository({
        lease: async () => {
          throw new Phase7MutationCoordinatorUnavailableError()
        },
        storage: createStorage()
      }).consume(input)
    ).rejects.toMatchObject({ retryAfterSeconds: 5 })
  })
})

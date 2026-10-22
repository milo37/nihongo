import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createAdminCommandRateLimiter } from './adminCommandRateLimiter.js'

const baseInput = {
  actorId: '019d0000-0000-7000-8000-000000000001',
  clientIp: '203.0.113.7'
} as const

describe('Phase 7 ADMIN command rate limiter', () => {
  it.each([
    ['ADMIN_EDIT', 30],
    ['ADMIN_SENSITIVE', 10],
    ['REAUTHENTICATION', 5]
  ] as const)('%s exact limit까지 허용한다', async (group, count) => {
    const query = vi.fn(async (statement: { values: readonly unknown[] }) => {
      const keys = statement.values.filter(
        (value): value is string =>
          typeof value === 'string' &&
          value.startsWith(`application:phase7:${group}:`)
      )
      return keys.map((key) => ({
        key,
        count,
        windowStartedAt: 1_000n,
        nowMilliseconds: 1_000n
      }))
    })
    const limiter = createAdminCommandRateLimiter({
      client: { $queryRaw: query } as unknown as PrismaClient,
      keySecret: 'phase7-command-rate-secret'
    })

    await expect(
      limiter.consume({ ...baseInput, group })
    ).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['ADMIN_EDIT', 31, 600_000n],
    ['ADMIN_SENSITIVE', 11, 900_000n],
    ['REAUTHENTICATION', 6, 900_000n]
  ] as const)(
    '%s actor/IP bucket의 exact threshold를 한 DB statement로 적용한다',
    async (group, count, duration) => {
      const query = vi.fn().mockResolvedValue([
        {
          key: '',
          count,
          windowStartedAt: 1_000n,
          nowMilliseconds: 1_000n
        },
        {
          key: '',
          count,
          windowStartedAt: 1_000n,
          nowMilliseconds: 1_000n
        }
      ])
      const limiter = createAdminCommandRateLimiter({
        client: { $queryRaw: query } as unknown as PrismaClient,
        keySecret: 'phase7-command-rate-secret'
      })

      query.mockImplementationOnce(
        (statement: { values: readonly unknown[] }) => {
          const keys = statement.values.filter(
            (value): value is string =>
              typeof value === 'string' &&
              value.startsWith(`application:phase7:${group}:`)
          )
          return Promise.resolve([
            {
              key: keys[0],
              count,
              windowStartedAt: 1_000n,
              nowMilliseconds: 1_000n
            },
            {
              key: keys[1],
              count,
              windowStartedAt: 1_000n,
              nowMilliseconds: 1_000n
            }
          ])
        }
      )

      await expect(
        limiter.consume({ ...baseInput, group })
      ).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        phase7Disposition: 'NO_TX',
        retryAfterSeconds: Number(duration / 1_000n),
        retryable: true
      })
      expect(query).toHaveBeenCalledTimes(1)
      const statement = query.mock.calls[0]?.[0] as {
        values: readonly unknown[]
      }
      const keys = statement.values.filter(
        (value): value is string =>
          typeof value === 'string' &&
          value.startsWith(`application:phase7:${group}:`)
      )
      expect(keys).toHaveLength(2)
      expect(keys.join(' ')).not.toContain(baseInput.actorId)
      expect(keys.join(' ')).not.toContain(baseInput.clientIp)
    }
  )

  it('arbitrary storage errors are pre-transaction SERVICE_UNAVAILABLE', async () => {
    const limiter = createAdminCommandRateLimiter({
      client: {
        $queryRaw: vi.fn().mockRejectedValue(new Error('adapter failure'))
      } as unknown as PrismaClient,
      keySecret: 'phase7-command-rate-secret'
    })

    await expect(
      limiter.consume({ ...baseInput, group: 'ADMIN_EDIT' })
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      phase7Disposition: 'NO_TX',
      retryAfterSeconds: 5,
      retryable: true
    })
  })

  it('fails closed unless both atomic actor/IP rows are returned', async () => {
    const limiter = createAdminCommandRateLimiter({
      client: {
        $queryRaw: vi.fn().mockResolvedValue([
          {
            key: 'actor',
            count: 1,
            windowStartedAt: 1n,
            nowMilliseconds: 1n
          }
        ])
      } as unknown as PrismaClient,
      keySecret: 'phase7-command-rate-secret'
    })

    await expect(
      limiter.consume({ ...baseInput, group: 'ADMIN_EDIT' })
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      phase7Disposition: 'NO_TX',
      retryAfterSeconds: 5
    })
  })

  it.each([
    [
      'duplicate key',
      (keys: readonly string[]) => [
        {
          key: keys[0],
          count: 1,
          windowStartedAt: 1n,
          nowMilliseconds: 1n
        },
        {
          key: keys[0],
          count: 1,
          windowStartedAt: 1n,
          nowMilliseconds: 1n
        }
      ]
    ],
    [
      'wrong runtime type',
      (keys: readonly string[]) => [
        {
          key: keys[0],
          count: 1,
          windowStartedAt: '1',
          nowMilliseconds: 1n
        },
        {
          key: keys[1],
          count: 1,
          windowStartedAt: 1n,
          nowMilliseconds: 1n
        }
      ]
    ]
  ] as const)('fails closed for %s adapter rows', async (_name, rowsFor) => {
    const query = vi.fn(async (statement: { values: readonly unknown[] }) => {
      const keys = statement.values.filter(
        (value): value is string =>
          typeof value === 'string' &&
          value.startsWith('application:phase7:ADMIN_EDIT:')
      )
      return rowsFor(keys)
    })
    const limiter = createAdminCommandRateLimiter({
      client: { $queryRaw: query } as unknown as PrismaClient,
      keySecret: 'phase7-command-rate-secret'
    })

    await expect(
      limiter.consume({ ...baseInput, group: 'ADMIN_EDIT' })
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      phase7Disposition: 'NO_TX',
      retryAfterSeconds: 5
    })
  })
})

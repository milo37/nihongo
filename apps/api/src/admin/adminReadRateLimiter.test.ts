import { describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { createAdminReadRateLimiter } from './adminReadRateLimiter.js'

const input = {
  actorId: '019d0000-0000-7000-8000-000000000001',
  clientIp: '203.0.113.7'
}

describe('Phase 7 ADMIN_READ rate limiter', () => {
  it('consumes actor and trusted-IP buckets in one DB statement', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        key: 'actor',
        count: 120,
        windowStartedAt: 1_000n,
        nowMilliseconds: 2_000n
      },
      {
        key: 'ip',
        count: 120,
        windowStartedAt: 1_000n,
        nowMilliseconds: 2_000n
      }
    ])
    const limiter = createAdminReadRateLimiter({
      client: { $queryRaw: query } as unknown as PrismaClient,
      keySecret: 'rate-secret'
    })

    await expect(limiter.consume(input)).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledTimes(1)
    const statement = query.mock.calls[0]?.[0] as { values: readonly unknown[] }
    const keys = statement.values.filter(
      (value): value is string =>
        typeof value === 'string' &&
        value.startsWith('application:phase7:ADMIN_READ:')
    )
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
    expect(keys.join(' ')).not.toContain(input.actorId)
    expect(keys.join(' ')).not.toContain(input.clientIp)
  })

  it('uses the maximum Retry-After when actor and IP are both over limit', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        key: 'actor',
        count: 121,
        windowStartedAt: 10_000n,
        nowMilliseconds: 50_000n
      },
      {
        key: 'ip',
        count: 121,
        windowStartedAt: 30_000n,
        nowMilliseconds: 50_000n
      }
    ])
    const limiter = createAdminReadRateLimiter({
      client: { $queryRaw: query } as unknown as PrismaClient,
      keySecret: 'rate-secret'
    })

    await expect(limiter.consume(input)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 40,
      retryable: true
    })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('fails closed when both atomic bucket rows are not returned', async () => {
    const limiter = createAdminReadRateLimiter({
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
      keySecret: 'rate-secret'
    })

    await expect(limiter.consume(input)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryAfterSeconds: 5,
      retryable: true
    })
  })

  it('maps retryable transaction conflicts to 503', async () => {
    const limiter = createAdminReadRateLimiter({
      client: {
        $queryRaw: vi.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('conflict', {
            code: 'P2034',
            clientVersion: '7.9.1'
          })
        )
      } as unknown as PrismaClient,
      keySecret: 'rate-secret'
    })

    await expect(limiter.consume(input)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryAfterSeconds: 5,
      retryable: true
    })
  })
})

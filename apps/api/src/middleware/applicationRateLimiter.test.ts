import { errorStatusByCode } from '@nihongo/contracts/common/error'
import { describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { createApplicationRateLimiter } from './applicationRateLimiter.js'

describe('application rate limiter', () => {
  it('허용량 초과 시 정확한 fixed-window Retry-After를 반환한다', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ count: 1, lastRequest: 1_000n }])
      .mockResolvedValueOnce([{ count: 2, lastRequest: 1_000n }])
    const limiter = createApplicationRateLimiter({
      client: { $queryRaw: query } as unknown as PrismaClient,
      keySecret: 'test-secret',
      now: () => 1_000
    })
    const input = {
      clientIp: '127.0.0.1',
      max: 1,
      operation: 'study-create',
      windowMs: 60_000
    }

    await expect(limiter.consume(input)).resolves.toBeUndefined()
    await expect(limiter.consume(input)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 60
    })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('window 경계에서 reset하고 client·operation key를 격리한다', async () => {
    let now = 1_000
    const rows = new Map<string, { count: number; lastRequest: bigint }>()
    const query = vi.fn(async (statement: { values: readonly unknown[] }) => {
      const key = statement.values[1]
      const requestTime = statement.values[2]
      const resetBefore = statement.values[3]
      if (
        typeof key !== 'string' ||
        typeof requestTime !== 'bigint' ||
        typeof resetBefore !== 'bigint'
      ) {
        throw new Error('Rate limiter SQL parameter fixture is invalid.')
      }

      const existing = rows.get(key)
      const row =
        !existing || existing.lastRequest <= resetBefore
          ? { count: 1, lastRequest: requestTime }
          : { count: existing.count + 1, lastRequest: existing.lastRequest }
      rows.set(key, row)
      return [row]
    })
    const limiter = createApplicationRateLimiter({
      client: { $queryRaw: query } as unknown as PrismaClient,
      keySecret: 'test-secret',
      now: () => now
    })
    const base = {
      clientIp: '127.0.0.1',
      max: 1,
      operation: 'study-create',
      windowMs: 60_000
    }

    await limiter.consume(base)
    await expect(limiter.consume(base)).rejects.toMatchObject({
      code: 'RATE_LIMITED'
    })

    now = 61_000
    await expect(limiter.consume(base)).resolves.toBeUndefined()
    await expect(
      limiter.consume({ ...base, clientIp: '127.0.0.2' })
    ).resolves.toBeUndefined()
    await expect(
      limiter.consume({ ...base, operation: 'study-read' })
    ).resolves.toBeUndefined()

    expect(rows).toHaveLength(3)
  })

  it.each(['P1001', 'P2024', 'P2034'])(
    '%s를 retryable 503으로 분류한다',
    async (code) => {
      const query = vi.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('database unavailable', {
          code,
          clientVersion: '7.9.1'
        })
      )
      const limiter = createApplicationRateLimiter({
        client: { $queryRaw: query } as unknown as PrismaClient,
        keySecret: 'test-secret',
        now: () => 1_000
      })

      try {
        await limiter.consume({
          clientIp: '127.0.0.1',
          max: 1,
          operation: 'study-create',
          windowMs: 60_000
        })
        throw new Error('Expected limiter failure.')
      } catch (error: unknown) {
        expect(error).toMatchObject({
          code: 'SERVICE_UNAVAILABLE',
          retryable: true,
          retryAfterSeconds: 5
        })
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'SERVICE_UNAVAILABLE'
        ) {
          throw error
        }
        expect(errorStatusByCode[error.code]).toBe(503)
      }
    }
  )
})

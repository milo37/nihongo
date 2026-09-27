import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createQuestionReportRateLimiter } from './questionReportRateLimiter.js'

interface SqlStatement {
  readonly values: readonly unknown[]
}

const actorInput = {
  actorId: '019d0000-0000-7000-8000-000000000001',
  clientIp: '203.0.113.7',
  group: 'REPORT_ACTOR'
} as const
const versionInput = {
  group: 'REPORT_VERSION',
  value: '019d0000-0000-7000-8000-000000000002'
} as const
const keySecret = 'phase7-report-rate-secret'

const rateKeys = (
  statement: SqlStatement,
  group: 'REPORT_ACTOR' | 'REPORT_VERSION'
): string[] =>
  statement.values.filter(
    (value): value is string =>
      typeof value === 'string' &&
      value.startsWith(`application:phase7:${group}:`)
  )

describe('Phase 7 question report rate limiter', () => {
  it('atomically consumes hashed actor and trusted-IP buckets at the exact limit', async () => {
    const query = vi.fn(async (statement: SqlStatement) =>
      rateKeys(statement, 'REPORT_ACTOR').map((key) => ({
        key,
        count: 5,
        windowStartedAt: 1_000n,
        nowMilliseconds: 1_000n
      }))
    )
    const limiter = createQuestionReportRateLimiter({
      client: { $queryRaw: query } as unknown as PrismaClient,
      keySecret
    })

    await expect(limiter.consume(actorInput)).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledTimes(1)
    const statement = query.mock.calls[0]![0]
    const keys = rateKeys(statement, 'REPORT_ACTOR')
    expect(keys).toHaveLength(2)
    expect(keys.some((key) => key.includes(':ACTOR:'))).toBe(true)
    expect(keys.some((key) => key.includes(':IP:'))).toBe(true)
    expect(statement.values.join(' ')).not.toContain(actorInput.actorId)
    expect(statement.values.join(' ')).not.toContain(actorInput.clientIp)
  })

  it('uses the longest Retry-After when actor and IP are both over limit', async () => {
    const query = vi.fn(async (statement: SqlStatement) => {
      const keys = rateKeys(statement, 'REPORT_ACTOR')
      return keys.map((key, index) => ({
        key,
        count: 6,
        windowStartedAt: index === 0 ? 0n : 100_000n,
        nowMilliseconds: 200_000n
      }))
    })
    const limiter = createQuestionReportRateLimiter({
      client: { $queryRaw: query } as unknown as PrismaClient,
      keySecret
    })

    await expect(limiter.consume(actorInput)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      phase7Disposition: 'NO_TX',
      retryAfterSeconds: 500,
      retryable: true
    })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('consumes one hashed target-version bucket at its exact limit', async () => {
    const query = vi.fn(async (statement: SqlStatement) =>
      rateKeys(statement, 'REPORT_VERSION').map((key) => ({
        key,
        count: 20,
        windowStartedAt: 1_000n,
        nowMilliseconds: 1_000n
      }))
    )
    const limiter = createQuestionReportRateLimiter({
      client: { $queryRaw: query } as unknown as PrismaClient,
      keySecret
    })

    await expect(limiter.consume(versionInput)).resolves.toBeUndefined()
    const statement = query.mock.calls[0]![0]
    const keys = rateKeys(statement, 'REPORT_VERSION')
    expect(keys).toHaveLength(1)
    expect(keys[0]).toContain(':VERSION:')
    expect(statement.values.join(' ')).not.toContain(versionInput.value)
  })

  it('fails closed unless every expected atomic bucket row is returned', async () => {
    const limiter = createQuestionReportRateLimiter({
      client: {
        $queryRaw: vi.fn().mockResolvedValue([
          {
            key: 'wrong',
            count: 1,
            windowStartedAt: 1n,
            nowMilliseconds: 1n
          }
        ])
      } as unknown as PrismaClient,
      keySecret
    })

    await expect(limiter.consume(actorInput)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      phase7Disposition: 'NO_TX',
      retryAfterSeconds: 5
    })
  })

  it('maps storage failures before domain work', async () => {
    const limiter = createQuestionReportRateLimiter({
      client: {
        $queryRaw: vi.fn().mockRejectedValue(new Error('adapter failure'))
      } as unknown as PrismaClient,
      keySecret
    })

    await expect(limiter.consume(actorInput)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      phase7Disposition: 'NO_TX',
      retryAfterSeconds: 5,
      retryable: true
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { createApplicationRateLimiter } from './applicationRateLimiter.js'

interface Row {
  count: number
  lastRequest: bigint
}

const fixture = () => {
  let currentTime = 1_000
  const query = vi
    .fn<(query: Prisma.Sql) => Promise<Row[]>>()
    .mockImplementation(async () => [
      { count: 1, lastRequest: BigInt(currentTime) }
    ])
  const read = vi
    .fn<() => Promise<Row | null>>()
    .mockResolvedValue({ count: 2, lastRequest: 1_000n })
  const client = {
    $queryRaw: query,
    rateLimit: { findUnique: read }
  } as unknown as PrismaClient
  const limiter = createApplicationRateLimiter({
    client,
    keySecret: 'rate-limit-unit-fixture-only',
    now: () => currentTime
  })
  const input = {
    clientIp: '192.0.2.1',
    max: 2,
    operation: 'study-submit',
    windowMs: 60_000
  }
  return {
    limiter,
    query,
    read,
    input,
    at: (value: number) => {
      currentTime = value
    }
  }
}

describe('application limiter denial cost without changing admission budgets', () => {
  it('admits the final permit and rejects warm overflow without a DB call', async () => {
    const f = fixture()
    f.query
      .mockResolvedValue([{ count: 3, lastRequest: 1_000n }])
      .mockResolvedValueOnce([{ count: 1, lastRequest: 1_000n }])
      .mockResolvedValueOnce([{ count: 2, lastRequest: 1_000n }])
    await f.limiter.consume(f.input)
    await f.limiter.consume(f.input)
    f.at(12_345)
    await expect(f.limiter.consume(f.input)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      retryAfterSeconds: 49
    })
    f.at(20_000)
    await expect(f.limiter.consume(f.input)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 41
    })
    expect(f.query).toHaveBeenCalledTimes(2)
    expect(f.read).not.toHaveBeenCalled()
    const statement = f.query.mock.calls[0]![0]
    expect(statement.sql).toMatch(
      /WHERE "RateLimit"\."lastRequest" <= \?\s+OR "RateLimit"\."count" < \?/
    )
    expect(statement.values.at(-1)).toBe(2)
  })

  it('confirms a cold exhausted row once without extending its deadline', async () => {
    const f = fixture()
    f.query.mockResolvedValue([])
    f.at(12_345)
    await expect(f.limiter.consume(f.input)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 49
    })
    f.at(60_999)
    await expect(f.limiter.consume(f.input)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 1
    })
    expect(f.query).toHaveBeenCalledTimes(1)
    expect(f.read).toHaveBeenCalledTimes(1)
  })

  it('expires a denial at the exact fixed-window boundary and consumes again', async () => {
    const f = fixture()
    f.query.mockResolvedValueOnce([{ count: 2, lastRequest: 1_000n }])
    await f.limiter.consume(f.input)
    f.at(60_999)
    await expect(f.limiter.consume(f.input)).rejects.toMatchObject({
      code: 'RATE_LIMITED'
    })
    f.at(61_000)
    await expect(f.limiter.consume(f.input)).resolves.toBeUndefined()
    expect(f.query).toHaveBeenCalledTimes(2)
    expect(f.read).not.toHaveBeenCalled()
  })

  it('keeps IP, operation and changed max/window policies out of another denial', async () => {
    const f = fixture()
    const input = { ...f.input, max: 1 }
    await f.limiter.consume(input)
    await f.limiter.consume({ ...input, clientIp: '192.0.2.2' })
    await f.limiter.consume({ ...input, operation: 'study-read' })
    await f.limiter.consume({ ...input, max: 2 })
    await f.limiter.consume({ ...input, windowMs: 30_000 })
    await expect(f.limiter.consume(input)).rejects.toMatchObject({
      code: 'RATE_LIMITED'
    })
    expect(f.query).toHaveBeenCalledTimes(5)
  })

  it('keeps a concurrent cold miss rejected after another call uses the final permit', async () => {
    const f = fixture()
    f.query
      .mockResolvedValueOnce([{ count: 1, lastRequest: 1_000n }])
      .mockResolvedValueOnce([])
    const settled = await Promise.allSettled([
      f.limiter.consume({ ...f.input, max: 1 }),
      f.limiter.consume({ ...f.input, max: 1 })
    ])
    expect(settled[0].status).toBe('fulfilled')
    expect(settled[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'RATE_LIMITED' }
    })
    expect(f.query).toHaveBeenCalledTimes(2)
    expect(f.read).not.toHaveBeenCalled()
  })

  it.each([1_001, 61_001])(
    'admits an earlier request when a later window completes at %d',
    async (completionTime) => {
      const f = fixture()
      const input = { ...f.input, max: 20 }
      let completeFirst!: (rows: Row[]) => void
      f.query
        .mockImplementationOnce(
          () =>
            new Promise<Row[]>((resolve) => {
              completeFirst = resolve
            })
        )
        .mockResolvedValueOnce([{ count: 1, lastRequest: 1_001n }])

      const first = f.limiter.consume(input)
      f.at(1_001)
      await expect(f.limiter.consume(input)).resolves.toBeUndefined()
      f.at(completionTime)
      completeFirst([{ count: 2, lastRequest: 1_001n }])
      await expect(first).resolves.toBeUndefined()

      expect(f.query.mock.calls[0]![0].values).toContain(1_000n)
      expect(f.query.mock.calls[1]![0].values).toContain(1_001n)
      expect(f.query).toHaveBeenCalledTimes(2)
      expect(f.read).not.toHaveBeenCalled()
    }
  )

  it('uses the cold read completion time when another worker resets an exhausted window', async () => {
    const f = fixture()
    const peer = fixture()
    const input = { ...f.input, max: 1 }
    let completeRead!: (row: Row) => void
    f.query.mockResolvedValueOnce([])
    f.read.mockImplementationOnce(
      () =>
        new Promise<Row>((resolve) => {
          completeRead = resolve
        })
    )
    f.at(60_000)
    const first = f.limiter.consume(input)
    await Promise.resolve()
    expect(f.read).toHaveBeenCalledTimes(1)

    peer.at(60_001)
    await expect(peer.limiter.consume(input)).resolves.toBeUndefined()
    f.at(60_001)
    completeRead({ count: 1, lastRequest: 60_001n })
    await expect(first).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 60
    })
    await expect(f.limiter.consume(input)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 60
    })
    expect(f.query).toHaveBeenCalledTimes(1)
    expect(f.read).toHaveBeenCalledTimes(1)
    expect(peer.query).toHaveBeenCalledTimes(1)
  })

  it.each([
    { label: 'missing', row: null },
    { label: 'not exhausted', row: { count: 1, lastRequest: 1_000n } },
    { label: 'expired', row: { count: 2, lastRequest: 0n } },
    { label: 'future', row: { count: 2, lastRequest: 62_000n } },
    { label: 'invalid count', row: { count: Number.NaN, lastRequest: 1_000n } }
  ])('fails closed when a cold rejection is $label', async ({ row }) => {
    const f = fixture()
    f.at(61_001)
    f.query.mockResolvedValue([])
    f.read.mockResolvedValue(row)
    await expect(f.limiter.consume(f.input)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryAfterSeconds: 5
    })
    await expect(f.limiter.consume(f.input)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE'
    })
    expect(f.query).toHaveBeenCalledTimes(2)
    expect(f.read).toHaveBeenCalledTimes(2)
  })

  it.each([
    { label: 'zero count', rows: [{ count: 0, lastRequest: 1_000n }] },
    { label: 'overflow', rows: [{ count: 3, lastRequest: 1_000n }] },
    { label: 'future window', rows: [{ count: 1, lastRequest: 2_000n }] },
    {
      label: 'multiple rows',
      rows: [
        { count: 1, lastRequest: 1_000n },
        { count: 1, lastRequest: 1_000n }
      ]
    }
  ])('does not authorize $label RETURNING rows', async ({ rows }) => {
    const f = fixture()
    f.query.mockResolvedValue(rows)
    await expect(f.limiter.consume(f.input)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryAfterSeconds: 5
    })
    expect(f.read).not.toHaveBeenCalled()
  })

  it.each(['upsert', 'read'] as const)(
    'preserves fail-closed DB errors at %s',
    async (stage) => {
      const f = fixture()
      const error = new Prisma.PrismaClientKnownRequestError(
        'fixture unavailable',
        {
          code: 'P2024',
          clientVersion: 'unit-test'
        }
      )
      if (stage === 'upsert') f.query.mockRejectedValueOnce(error)
      else {
        f.query.mockResolvedValueOnce([])
        f.read.mockRejectedValueOnce(error)
      }
      await expect(f.limiter.consume(f.input)).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        retryAfterSeconds: 5
      })
      await expect(f.limiter.consume(f.input)).resolves.toBeUndefined()
      expect(f.query).toHaveBeenCalledTimes(2)
    }
  )

  it('bounds the negative cache and lets an evicted key consult the DB again', async () => {
    const f = fixture()
    for (let index = 0; index <= 4_096; index += 1) {
      await f.limiter.consume({
        ...f.input,
        max: 1,
        operation: `cache-fixture-${index}`
      })
    }
    expect(f.query).toHaveBeenCalledTimes(4_097)
    await expect(
      f.limiter.consume({
        ...f.input,
        max: 1,
        operation: 'cache-fixture-4096'
      })
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(f.query).toHaveBeenCalledTimes(4_097)
    await f.limiter.consume({
      ...f.input,
      max: 1,
      operation: 'cache-fixture-0'
    })
    expect(f.query).toHaveBeenCalledTimes(4_098)
  })
})

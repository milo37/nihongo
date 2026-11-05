import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Prisma } from '../generated/prisma/client.js'
import {
  consumeRateLimitKeys,
  createRateLimitKey
} from './keyedRateLimitStore.js'

const keySecret = 'a'.repeat(32)
const settings = {
  storeUnavailableMessage: 'store',
  stateInvalidMessage: 'state',
  rateLimitedMessage: 'limited'
}
const policy = { limit: 2, windowMilliseconds: 60_000 }
const keys = ['k-actor', 'k-ip']

const clientReturning = (rows: unknown) => ({
  $queryRaw: async () => rows
})
const row = (key: string, count: number) => ({
  key,
  count,
  windowStartedAt: 1_000n,
  nowMilliseconds: 31_000n
})

describe('createRateLimitKey', () => {
  it('keeps the existing HMAC key format', () => {
    const digest = createHmac('sha256', keySecret)
      .update('keyed:ADMIN_READ:ACTOR:user-1', 'utf8')
      .digest('hex')
    expect(
      createRateLimitKey({
        dimension: 'ACTOR',
        group: 'ADMIN_READ',
        keySecret,
        value: 'user-1'
      })
    ).toBe(`application:keyed:ADMIN_READ:ACTOR:${digest}`)
  })
})

describe('consumeRateLimitKeys', () => {
  it('passes while every key is within the limit', async () => {
    await expect(
      consumeRateLimitKeys({
        client: clientReturning([row('k-actor', 2), row('k-ip', 1)]) as never,
        keys,
        policy,
        settings
      })
    ).resolves.toBeUndefined()
  })

  it('reports the remaining window when a key exceeds the limit', async () => {
    await expect(
      consumeRateLimitKeys({
        client: clientReturning([row('k-actor', 3), row('k-ip', 1)]) as never,
        keys,
        policy,
        settings: { ...settings, adminDisposition: 'NO_TX' }
      })
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: 'limited',
      retryAfterSeconds: 30,
      adminDisposition: 'NO_TX'
    })
  })

  it('rejects missing or malformed rows as unavailable', async () => {
    for (const rows of [
      [row('k-actor', 1)],
      [row('k-actor', 1), row('k-actor', 1)],
      [row('k-actor', 0), row('k-ip', 1)]
    ]) {
      await expect(
        consumeRateLimitKeys({
          client: clientReturning(rows) as never,
          keys,
          policy,
          settings
        })
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: 'state' })
    }
  })

  it('maps store errors unless the limiter narrows them', async () => {
    const failing = {
      $queryRaw: async () => {
        throw new Error('syntax')
      }
    }
    await expect(
      consumeRateLimitKeys({ client: failing as never, keys, policy, settings })
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: 'store' })
    await expect(
      consumeRateLimitKeys({
        client: failing as never,
        keys,
        policy,
        settings: {
          ...settings,
          isStoreError: (error) =>
            error instanceof Prisma.PrismaClientInitializationError
        }
      })
    ).rejects.toThrow('syntax')
  })
})

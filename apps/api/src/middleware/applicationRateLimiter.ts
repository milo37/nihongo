import { createHmac, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApplicationError } from '../errors/applicationError.js'

export interface ApplicationRateLimitInput {
  clientIp: string
  max: number
  operation: string
  windowMs: number
}

export interface ApplicationRateLimiter {
  consume: (input: ApplicationRateLimitInput) => Promise<void>
}

interface CreateApplicationRateLimiterDependencies {
  client: PrismaClient
  keySecret: string
  now?: () => number
}

interface RateLimitRow {
  count: number
  lastRequest: bigint
}

const DENIAL_CACHE_CAPACITY = 4_096

const unavailable = (cause?: unknown): ApplicationError =>
  new ApplicationError({
    code: 'SERVICE_UNAVAILABLE',
    message: '요청 제한 저장소에 연결할 수 없습니다.',
    retryable: true,
    retryAfterSeconds: 5,
    cause
  })

const validRow = (
  row: RateLimitRow | null | undefined,
  nowMilliseconds: bigint
): row is RateLimitRow =>
  row !== null &&
  row !== undefined &&
  Number.isSafeInteger(row.count) &&
  row.count > 0 &&
  typeof row.lastRequest === 'bigint' &&
  row.lastRequest >= 0n &&
  row.lastRequest <= nowMilliseconds

const rateLimited = (
  resetAt: bigint,
  nowMilliseconds: bigint
): ApplicationError =>
  new ApplicationError({
    code: 'RATE_LIMITED',
    message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    retryable: true,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil(Number(resetAt - nowMilliseconds) / 1_000)
    )
  })

export const createApplicationRateLimiter = ({
  client,
  keySecret,
  now = Date.now
}: CreateApplicationRateLimiterDependencies): ApplicationRateLimiter => {
  // shortcut: only warm local denials skip DB; revisit if cold-denial reads dominate.
  const deniedUntil = new Map<string, bigint>()
  const rememberDenial = (key: string, resetAt: bigint): void => {
    const previous = deniedUntil.get(key)
    if (previous !== undefined && previous >= resetAt) return
    if (!deniedUntil.has(key) && deniedUntil.size >= DENIAL_CACHE_CAPACITY) {
      const oldest = deniedUntil.keys().next().value
      if (oldest !== undefined) deniedUntil.delete(oldest)
    }
    deniedUntil.set(key, resetAt)
  }

  return {
    consume: async ({ clientIp, max, operation, windowMs }) => {
      const keyDigest = createHmac('sha256', keySecret)
        .update(`${operation}:${clientIp}`)
        .digest('hex')
      const key = `application:${operation}:${keyDigest}`
      const cacheKey = `${key}:${max}:${windowMs}`
      let nowMilliseconds = BigInt(now())
      const windowMilliseconds = BigInt(windowMs)
      const resetBefore = nowMilliseconds - windowMilliseconds
      const cachedReset = deniedUntil.get(cacheKey)
      if (cachedReset !== undefined) {
        if (cachedReset > nowMilliseconds) {
          throw rateLimited(cachedReset, nowMilliseconds)
        }
        deniedUntil.delete(cacheKey)
      }

      try {
        const rows = await client.$queryRaw<RateLimitRow[]>(Prisma.sql`
          INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest")
          VALUES (${randomUUID()}::uuid, ${key}, 1, ${nowMilliseconds})
          ON CONFLICT ("key") DO UPDATE SET
            "count" = CASE
              WHEN "RateLimit"."lastRequest" <= ${resetBefore} THEN 1
              ELSE "RateLimit"."count" + 1
            END,
            "lastRequest" = CASE
              WHEN "RateLimit"."lastRequest" <= ${resetBefore}
                THEN ${nowMilliseconds}
              ELSE "RateLimit"."lastRequest"
            END
          WHERE "RateLimit"."lastRequest" <= ${resetBefore}
            OR "RateLimit"."count" < ${max}
          RETURNING "count", "lastRequest"`)

        // Observe concurrent windows now; expiry still follows the SQL snapshot.
        nowMilliseconds = BigInt(now())
        if (rows.length === 0) {
          const concurrentReset = deniedUntil.get(cacheKey)
          if (
            concurrentReset !== undefined &&
            concurrentReset > nowMilliseconds
          ) {
            throw rateLimited(concurrentReset, nowMilliseconds)
          }
          const row = await client.rateLimit.findUnique({
            where: { key },
            select: { count: true, lastRequest: true }
          })
          nowMilliseconds = BigInt(now())
          if (
            !validRow(row, nowMilliseconds) ||
            row.count < max ||
            row.lastRequest <= resetBefore
          ) {
            throw unavailable()
          }
          const resetAt = row.lastRequest + windowMilliseconds
          rememberDenial(cacheKey, resetAt)
          throw rateLimited(resetAt, nowMilliseconds)
        }

        const row = rows[0]
        if (
          rows.length !== 1 ||
          !validRow(row, nowMilliseconds) ||
          row.count > max ||
          row.lastRequest <= resetBefore
        ) {
          throw unavailable()
        }
        if (row.count === max) {
          rememberDenial(cacheKey, row.lastRequest + windowMilliseconds)
        }
      } catch (error: unknown) {
        if (
          error instanceof Prisma.PrismaClientInitializationError ||
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            ['P1001', 'P1002', 'P2024', 'P2034'].includes(error.code))
        ) {
          throw unavailable(error)
        }
        throw error
      }
    }
  }
}

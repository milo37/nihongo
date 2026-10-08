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

export const createApplicationRateLimiter = ({
  client,
  keySecret,
  now = Date.now
}: CreateApplicationRateLimiterDependencies): ApplicationRateLimiter => ({
  consume: async ({ clientIp, max, operation, windowMs }) => {
    const keyDigest = createHmac('sha256', keySecret)
      .update(`${operation}:${clientIp}`)
      .digest('hex')
    const key = `application:${operation}:${keyDigest}`
    const nowMilliseconds = BigInt(now())
    const resetBefore = nowMilliseconds - BigInt(windowMs)
    let rows: Array<{ count: number; lastRequest: bigint }>
    try {
      rows = await client.$queryRaw<
        Array<{ count: number; lastRequest: bigint }>
      >(Prisma.sql`
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
      RETURNING "count", "lastRequest"`)
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientInitializationError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P1001', 'P1002', 'P2024', 'P2034'].includes(error.code))
      ) {
        throw new ApplicationError({
          code: 'SERVICE_UNAVAILABLE',
          message: '요청 제한 저장소에 연결할 수 없습니다.',
          retryable: true,
          retryAfterSeconds: 5,
          cause: error
        })
      }
      throw error
    }

    const row = rows[0]
    if ((row?.count ?? max + 1) > max) {
      const retryAfterSeconds = row
        ? Math.max(
            1,
            Math.ceil(
              Number(row.lastRequest + BigInt(windowMs) - nowMilliseconds) /
                1_000
            )
          )
        : Math.max(1, Math.ceil(windowMs / 1_000))
      throw new ApplicationError({
        code: 'RATE_LIMITED',
        message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
        retryable: true,
        retryAfterSeconds
      })
    }
  }
})

import { createHmac, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApplicationError } from '../errors/applicationError.js'

const ADMIN_READ_LIMIT = 120
const ADMIN_READ_WINDOW_MS = 60_000

interface AdminReadRateLimitInput {
  actorId: string
  clientIp: string
}

export interface AdminReadRateLimiter {
  consume: (input: AdminReadRateLimitInput) => Promise<void>
}

interface RateLimitRow {
  count: number
  key: string
  nowMilliseconds: bigint
  windowStartedAt: bigint
}

const isUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P1001', 'P1002', 'P2024', 'P2034'].includes(error.code))

const toKey = ({
  dimension,
  keySecret,
  value
}: {
  dimension: 'ACTOR' | 'IP'
  keySecret: string
  value: string
}): string => {
  const digest = createHmac('sha256', keySecret)
    .update(`phase7:ADMIN_READ:${dimension}:${value}`, 'utf8')
    .digest('hex')

  return `application:phase7:ADMIN_READ:${dimension}:${digest}`
}

export const createAdminReadRateLimiter = ({
  client,
  keySecret
}: {
  client: Pick<PrismaClient, '$queryRaw'>
  keySecret: string
}): AdminReadRateLimiter => ({
  consume: async ({ actorId, clientIp }) => {
    const actorKey = toKey({
      dimension: 'ACTOR',
      keySecret,
      value: actorId
    })
    const clientIpKey = toKey({
      dimension: 'IP',
      keySecret,
      value: clientIp
    })

    let rows: RateLimitRow[]
    try {
      rows = await client.$queryRaw<RateLimitRow[]>(Prisma.sql`
        WITH now_value AS MATERIALIZED (
          SELECT floor(
            extract(epoch FROM clock_timestamp()) * 1000
          )::bigint AS now_ms
        ),
        rate_keys(id, key) AS (
          VALUES
            (${randomUUID()}::uuid, ${actorKey}),
            (${randomUUID()}::uuid, ${clientIpKey})
        ),
        consumed AS (
          INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest")
          SELECT rate_keys.id, rate_keys.key, 1, now_value.now_ms
          FROM rate_keys
          CROSS JOIN now_value
          ORDER BY rate_keys.key
          ON CONFLICT ("key") DO UPDATE SET
            "count" = CASE
              WHEN (
                SELECT now_ms FROM now_value
              ) >= "RateLimit"."lastRequest" + ${BigInt(ADMIN_READ_WINDOW_MS)}
                THEN 1
              ELSE "RateLimit"."count" + 1
            END,
            "lastRequest" = CASE
              WHEN (
                SELECT now_ms FROM now_value
              ) >= "RateLimit"."lastRequest" + ${BigInt(ADMIN_READ_WINDOW_MS)}
                THEN (SELECT now_ms FROM now_value)
              ELSE "RateLimit"."lastRequest"
            END
          RETURNING "key", "count", "lastRequest"
        )
        SELECT
          consumed."key" AS "key",
          consumed."count" AS "count",
          consumed."lastRequest" AS "windowStartedAt",
          now_value.now_ms AS "nowMilliseconds"
        FROM consumed
        CROSS JOIN now_value
      `)
    } catch (error: unknown) {
      if (isUnavailableError(error)) {
        throw new ApplicationError({
          code: 'SERVICE_UNAVAILABLE',
          message: '관리자 조회 제한 저장소에 연결할 수 없습니다.',
          retryable: true,
          retryAfterSeconds: 5,
          cause: error
        })
      }
      throw error
    }

    if (rows.length !== 2) {
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '관리자 조회 제한 상태를 확인할 수 없습니다.',
        retryable: true,
        retryAfterSeconds: 5
      })
    }

    const exceeded = rows.filter((row) => row.count > ADMIN_READ_LIMIT)
    if (exceeded.length === 0) {
      return
    }

    const retryAfterSeconds = Math.max(
      ...exceeded.map((row) =>
        Math.max(
          1,
          Math.ceil(
            Number(
              row.windowStartedAt +
                BigInt(ADMIN_READ_WINDOW_MS) -
                row.nowMilliseconds
            ) / 1_000
          )
        )
      )
    )
    throw new ApplicationError({
      code: 'RATE_LIMITED',
      message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      retryable: true,
      retryAfterSeconds
    })
  }
})

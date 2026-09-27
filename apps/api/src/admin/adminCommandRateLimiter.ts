import { createHmac, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApplicationError } from '../errors/applicationError.js'

export type AdminCommandRateLimitGroup =
  | 'ADMIN_EDIT'
  | 'ADMIN_SENSITIVE'
  | 'REAUTHENTICATION'

interface AdminCommandRateLimitInput {
  actorId: string
  clientIp: string
  group: AdminCommandRateLimitGroup
}

export interface AdminCommandRateLimiter {
  consume: (input: AdminCommandRateLimitInput) => Promise<void>
}

interface RateLimitRow {
  count: number
  key: string
  nowMilliseconds: bigint
  windowStartedAt: bigint
}

const policyByGroup = {
  ADMIN_EDIT: { limit: 30, windowMilliseconds: 10 * 60_000 },
  ADMIN_SENSITIVE: { limit: 10, windowMilliseconds: 15 * 60_000 },
  REAUTHENTICATION: { limit: 5, windowMilliseconds: 15 * 60_000 }
} as const satisfies Readonly<
  Record<
    AdminCommandRateLimitGroup,
    { readonly limit: number; readonly windowMilliseconds: number }
  >
>

const toKey = ({
  dimension,
  group,
  keySecret,
  value
}: {
  dimension: 'ACTOR' | 'IP'
  group: AdminCommandRateLimitGroup
  keySecret: string
  value: string
}): string => {
  const digest = createHmac('sha256', keySecret)
    .update(`phase7:${group}:${dimension}:${value}`, 'utf8')
    .digest('hex')

  return `application:phase7:${group}:${dimension}:${digest}`
}

export const createAdminCommandRateLimiter = ({
  client,
  keySecret
}: {
  client: Pick<PrismaClient, '$queryRaw'>
  keySecret: string
}): AdminCommandRateLimiter => ({
  consume: async ({ actorId, clientIp, group }) => {
    const policy = policyByGroup[group]
    const actorKey = toKey({
      dimension: 'ACTOR',
      group,
      keySecret,
      value: actorId
    })
    const clientIpKey = toKey({
      dimension: 'IP',
      group,
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
              ) >= "RateLimit"."lastRequest" + ${BigInt(policy.windowMilliseconds)}
                THEN 1
              ELSE "RateLimit"."count" + 1
            END,
            "lastRequest" = CASE
              WHEN (
                SELECT now_ms FROM now_value
              ) >= "RateLimit"."lastRequest" + ${BigInt(policy.windowMilliseconds)}
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
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '관리자 명령 제한 저장소에 연결할 수 없습니다.',
        retryable: true,
        retryAfterSeconds: 5,
        phase7Disposition: 'NO_TX',
        cause: error
      })
    }

    const returnedKeys = new Set(rows.map((row) => row.key))
    if (
      rows.length !== 2 ||
      returnedKeys.size !== 2 ||
      !returnedKeys.has(actorKey) ||
      !returnedKeys.has(clientIpKey) ||
      rows.some(
        (row) =>
          !Number.isSafeInteger(row.count) ||
          row.count < 1 ||
          typeof row.windowStartedAt !== 'bigint' ||
          row.windowStartedAt < 0n ||
          typeof row.nowMilliseconds !== 'bigint' ||
          row.nowMilliseconds < row.windowStartedAt
      )
    ) {
      throw new ApplicationError({
        code: 'SERVICE_UNAVAILABLE',
        message: '관리자 명령 제한 상태를 확인할 수 없습니다.',
        retryable: true,
        retryAfterSeconds: 5,
        phase7Disposition: 'NO_TX'
      })
    }

    const exceeded = rows.filter((row) => row.count > policy.limit)
    if (exceeded.length === 0) return

    const retryAfterSeconds = Math.max(
      ...exceeded.map((row) =>
        Math.max(
          1,
          Math.ceil(
            Number(
              row.windowStartedAt +
                BigInt(policy.windowMilliseconds) -
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
      retryAfterSeconds,
      phase7Disposition: 'NO_TX'
    })
  }
})

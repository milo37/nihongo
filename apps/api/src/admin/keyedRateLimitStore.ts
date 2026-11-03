import { createHmac, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApplicationError } from '../errors/applicationError.js'

/** Fixed window shared by every key of one consume call. */
export interface RateLimitPolicy {
  readonly limit: number
  readonly windowMilliseconds: number
}

/** Per limiter settings; the SQL and window math are shared (#497). */
export interface KeyedRateLimitSettings {
  readonly storeUnavailableMessage: string
  readonly stateInvalidMessage: string
  readonly rateLimitedMessage: string
  /** Phase 7 command paths mark failures as before any transaction. */
  readonly phase7Disposition?: 'NO_TX'
  /** Which store errors become SERVICE_UNAVAILABLE; others are rethrown. */
  readonly isStoreError?: (error: unknown) => boolean
}

interface RateLimitRow {
  readonly count: number
  readonly key: string
  readonly nowMilliseconds: bigint
  readonly windowStartedAt: bigint
}

export const createRateLimitKey = ({
  dimension,
  group,
  keySecret,
  value
}: {
  readonly dimension: string
  readonly group: string
  readonly keySecret: string
  readonly value: string
}): string => {
  const digest = createHmac('sha256', keySecret)
    .update(`phase7:${group}:${dimension}:${value}`, 'utf8')
    .digest('hex')
  return `application:phase7:${group}:${dimension}:${digest}`
}

/** Counts every key once and rejects when any key exceeds the policy. */
export const consumeRateLimitKeys = async ({
  client,
  keys,
  policy,
  settings
}: {
  readonly client: Pick<PrismaClient, '$queryRaw'>
  readonly keys: readonly string[]
  readonly policy: RateLimitPolicy
  readonly settings: KeyedRateLimitSettings
}): Promise<void> => {
  const disposition = settings.phase7Disposition
    ? { phase7Disposition: settings.phase7Disposition }
    : {}
  const rateKeys = keys.map((key) => ({ id: randomUUID(), key }))
  let rows: RateLimitRow[]
  try {
    rows = await client.$queryRaw<RateLimitRow[]>(Prisma.sql`
      WITH now_value AS MATERIALIZED (
        SELECT floor(
          extract(epoch FROM clock_timestamp()) * 1000
        )::bigint AS now_ms
      ),
      rate_keys(id, key) AS (
        VALUES ${Prisma.join(
          rateKeys.map(({ id, key }) => Prisma.sql`(${id}::uuid, ${key})`)
        )}
      ),
      consumed AS (
        INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest")
        SELECT rate_keys.id, rate_keys.key, 1, now_value.now_ms
        FROM rate_keys
        CROSS JOIN now_value
        ORDER BY rate_keys.key
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE
            WHEN (SELECT now_ms FROM now_value) >=
              "RateLimit"."lastRequest" + ${BigInt(policy.windowMilliseconds)}
              THEN 1
            ELSE "RateLimit"."count" + 1
          END,
          "lastRequest" = CASE
            WHEN (SELECT now_ms FROM now_value) >=
              "RateLimit"."lastRequest" + ${BigInt(policy.windowMilliseconds)}
              THEN (SELECT now_ms FROM now_value)
            ELSE "RateLimit"."lastRequest"
          END
        RETURNING "key", "count", "lastRequest"
      )
      SELECT consumed."key" AS "key",
        consumed."count" AS "count",
        consumed."lastRequest" AS "windowStartedAt",
        now_value.now_ms AS "nowMilliseconds"
      FROM consumed
      CROSS JOIN now_value
    `)
  } catch (error: unknown) {
    if (settings.isStoreError && !settings.isStoreError(error)) throw error
    throw new ApplicationError({
      code: 'SERVICE_UNAVAILABLE',
      message: settings.storeUnavailableMessage,
      retryable: true,
      retryAfterSeconds: 5,
      ...disposition,
      cause: error
    })
  }

  const returnedKeys = new Set(rows.map((row) => row.key))
  if (
    rows.length !== keys.length ||
    returnedKeys.size !== keys.length ||
    keys.some((key) => !returnedKeys.has(key)) ||
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
      message: settings.stateInvalidMessage,
      retryable: true,
      retryAfterSeconds: 5,
      ...disposition
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
    message: settings.rateLimitedMessage,
    retryable: true,
    retryAfterSeconds,
    ...disposition
  })
}

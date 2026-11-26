import {
  DAILY_PUSH_URL,
  dailyPushBody,
  DAILY_PUSH_TITLE,
  type DailyPushPayload,
  type PushLocale
} from '@nihongo/contracts/notification/web-push'
import type { PrismaClient } from '../generated/prisma/client.js'

/** A subscription claimed for today's send. */
export interface ClaimedPushSubscription {
  readonly id: string
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
  readonly locale: PushLocale
  /** The member's daily goal now. */
  readonly dailyGoal: number
}

/**
 * Sends one encrypted message; resolves with the push service status, or
 * rejects when no status came back (network).
 */
export type PushSender = (
  subscription: ClaimedPushSubscription,
  payload: string
) => Promise<number>

export type PushOutcome = 'SENT' | 'REMOVE' | 'KEEP'

/**
 * 2xx sent. 404/410: the subscription is gone; 400/413: it is broken; both
 * are deleted. 429, 5xx and anything else are kept for tomorrow.
 */
export const classifyPushStatus = (status: number): PushOutcome =>
  status >= 200 && status < 300
    ? 'SENT'
    : [400, 404, 410, 413].includes(status)
      ? 'REMOVE'
      : 'KEEP'

/** The calendar day in Korea (Japan has the same 08:00). */
export const seoulDay = (now: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)

export const dailyPushPayload = (
  locale: PushLocale,
  dailyGoal: number
): string =>
  JSON.stringify({
    kind: 'DAILY_GOAL',
    title: DAILY_PUSH_TITLE[locale],
    body: dailyPushBody(locale, dailyGoal),
    url: DAILY_PUSH_URL
  } satisfies DailyPushPayload)

export interface DailyPushReport {
  readonly day: string
  readonly sent: number
  readonly removed: number
  readonly kept: number
  /** Status classes and error names of the kept ones; no endpoint. */
  readonly keptReasons: Readonly<Record<string, number>>
}

export const DAILY_PUSH_BATCH_SIZE = 500
export const DAILY_PUSH_CONCURRENCY = 20

/**
 * #1046: one push a day per subscription whose member is active and has a
 * daily goal; the
 * words carry that goal as it is at send time. Each batch is marked with today's
 * day before it is sent, so a second run the same day (or a run that died
 * halfway) never sends twice; a marked one that was not sent waits for
 * tomorrow.
 */
export const runDailyPush = async ({
  client,
  now,
  send,
  batchSize = DAILY_PUSH_BATCH_SIZE,
  concurrency = DAILY_PUSH_CONCURRENCY
}: {
  readonly client: Pick<PrismaClient, '$queryRaw' | '$executeRaw'>
  readonly now: Date
  readonly send: PushSender
  readonly batchSize?: number
  readonly concurrency?: number
}): Promise<DailyPushReport> => {
  const day = seoulDay(now)
  let sent = 0
  let removed = 0
  let kept = 0
  const keptReasons: Record<string, number> = {}
  const keep = (reason: string): void => {
    kept += 1
    keptReasons[reason] = (keptReasons[reason] ?? 0) + 1
  }

  for (;;) {
    const batch = await client.$queryRaw<ClaimedPushSubscription[]>`
      UPDATE "PushSubscription" AS push SET "lastSentDay" = ${day}::date
      FROM "UserStudyGoal" AS goal
      WHERE goal."userId" = push."userId"
        AND goal."dailyGoal" IS NOT NULL
        AND push."id" IN (
          SELECT candidate."id" FROM "PushSubscription" AS candidate
          JOIN "UserStudyGoal" AS candidateGoal
            ON candidateGoal."userId" = candidate."userId"
          JOIN "User" AS member ON member."id" = candidate."userId"
          WHERE candidate."lastSentDay" IS DISTINCT FROM ${day}::date
            AND candidateGoal."dailyGoal" IS NOT NULL
            -- A member who asked to be deleted gets nothing (back on restore).
            AND member."accountStatus" = 'ACTIVE'
          ORDER BY candidate."id"
          LIMIT ${batchSize}
          FOR UPDATE OF candidate SKIP LOCKED
        )
      RETURNING push."id", push."endpoint", push."p256dh", push."auth",
        push."locale", goal."dailyGoal"::integer AS "dailyGoal"`
    if (batch.length === 0) break

    const gone: string[] = []
    for (let start = 0; start < batch.length; start += concurrency) {
      await Promise.all(
        batch.slice(start, start + concurrency).map(async (subscription) => {
          let status: number
          try {
            status = await send(
              subscription,
              dailyPushPayload(subscription.locale, subscription.dailyGoal)
            )
          } catch (error: unknown) {
            keep(error instanceof Error ? error.name : 'Error')
            return
          }
          const outcome = classifyPushStatus(status)
          if (outcome === 'SENT') sent += 1
          else if (outcome === 'REMOVE') gone.push(subscription.id)
          else keep(`${Math.floor(status / 100)}xx:${status}`)
        })
      )
    }
    if (gone.length > 0) {
      removed += await client.$executeRaw`
        DELETE FROM "PushSubscription" WHERE "id" = ANY(${gone}::uuid[])`
    }
  }

  return { day, sent, removed, kept, keptReasons }
}

import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import webPush from 'web-push'
import { z } from 'zod'
import { createAuthRuntimePlan } from '../config/authRuntimePlan.js'
import { createDatabaseRuntime } from '../db/database.js'
import { createOperatorDatabaseClient } from '../db/operatorDatabase.js'
import { runDailyPush, seoulDay, type PushSender } from './dailyPush.js'

const inputSchema = z.object({
  WEB_PUSH_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{87}$/u),
  WEB_PUSH_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  /** VAPID contact: the site address (no personal mail). */
  WEB_PUSH_SUBJECT: z.string().regex(/^https:\/\/[^\s/]+\/?$/u),
  DAILY_PUSH_CONFIRM: z.literal('SEND_DAILY_PUSH').optional()
})

/** Twelve hours: a device that comes online at night gets nothing stale. */
export const DAILY_PUSH_TTL_SECONDS = 12 * 60 * 60

const write = (
  stream: NodeJS.WriteStream,
  value: Record<string, unknown>
): void => {
  stream.write(`${JSON.stringify(value)}\n`)
}

export const createWebPushSender = (
  vapidDetails: webPush.VapidKeys & { readonly subject: string }
): PushSender => {
  return async (subscription, payload) => {
    try {
      const result = await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth }
        },
        payload,
        {
          vapidDetails,
          TTL: DAILY_PUSH_TTL_SECONDS,
          contentEncoding: 'aes128gcm',
          timeout: 10_000
        }
      )
      return result.statusCode
    } catch (error: unknown) {
      if (error instanceof webPush.WebPushError) return error.statusCode
      throw error
    }
  }
}

/**
 * #1046: the 08:00 (Korea/Japan) daily web push, run by the scheduler on the
 * server. Without DAILY_PUSH_CONFIRM it only counts. Prints one JSON line with
 * counts only (no endpoint, key or database URL); exit 1 when nothing could be
 * sent although some were due, or on an error, so the alarm path sees it.
 */
export const runDailyPushCommand = async (
  source: NodeJS.ProcessEnv,
  now: Date = new Date()
): Promise<void> => {
  let disconnect = async (): Promise<void> => undefined
  try {
    const input = inputSchema.parse(source)
    const { environment } = createOperatorDatabaseClient(source, {
      allowStaging: true
    })
    const database = createDatabaseRuntime(
      z.string().min(1).parse(source.DATABASE_URL),
      {
        migrationProfile: createAuthRuntimePlan().migrationProfile,
        startupRole: createAuthRuntimePlan().applicationRole
      }
    )
    disconnect = database.disconnect
    await database.checkReadiness()
    if (input.DAILY_PUSH_CONFIRM === undefined) {
      const day = seoulDay(now)
      const [row] = await database.client.$queryRaw<[{ due: number }]>`
        SELECT count(*)::int AS "due" FROM "PushSubscription"
        WHERE "lastSentDay" IS DISTINCT FROM ${day}::date`
      write(process.stdout, {
        event: 'daily_push_dry_run',
        environment,
        day,
        due: row.due
      })
      return
    }
    const report = await runDailyPush({
      client: database.client,
      now,
      send: createWebPushSender({
        subject: input.WEB_PUSH_SUBJECT,
        publicKey: input.WEB_PUSH_PUBLIC_KEY,
        privateKey: input.WEB_PUSH_PRIVATE_KEY
      })
    })
    const failed = report.kept > 0 && report.sent === 0
    write(failed ? process.stderr : process.stdout, {
      event: failed ? 'daily_push_failed' : 'daily_push_sent',
      environment,
      ...report
    })
    if (failed) process.exitCode = 1
  } catch (error: unknown) {
    write(process.stderr, {
      event: 'daily_push_failed',
      code:
        error instanceof z.ZodError
          ? 'DAILY_PUSH_INPUT_INVALID'
          : error instanceof Error &&
              error.message === 'OPERATOR_ENVIRONMENT_INVALID'
            ? error.message
            : 'DAILY_PUSH_FAILED'
    })
    process.exitCode = 1
  } finally {
    await disconnect()
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ quiet: true })
  void runDailyPushCommand(process.env)
}

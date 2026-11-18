import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { createRoleDatabaseRuntime } from '../db/database.js'
import {
  REAPPLY_ERASURE_MAX_USERS,
  reapplyAccountErasures,
  type ReapplyErasureEntry
} from './accountErasureAuthority.js'
import { parseSsoAccountErasureCommandInput } from './ssoAccountErasureCommand.js'

const REAPPLY_CONFIRMATION = 'REAPPLY_ACCOUNT_ERASURE'

/** The database refuses an older time too: the logs keep 30 days. */
const REAPPLY_MAX_AGE_MS = 31 * 24 * 60 * 60_000

/**
 * One `<user id> <original request time>` per line (ISO 8601, as the log's
 * occurredAt); blank lines are ignored, anything else fails, and so does a
 * future time or one older than 31 days.
 */
export const parseReapplyEntries = (
  source: string,
  now: number = Date.now()
): ReapplyErasureEntry[] =>
  z
    .array(
      z
        .string()
        .transform((line) => line.split(/\s+/u))
        .pipe(z.tuple([z.uuid(), z.iso.datetime({ offset: true })]))
        .refine(
          ([, at]) =>
            Date.parse(at) <= now && Date.parse(at) >= now - REAPPLY_MAX_AGE_MS
        )
        .transform(([userId, at]) => ({
          userId,
          requestedAt: new Date(at).toISOString()
        }))
    )
    .max(REAPPLY_ERASURE_MAX_USERS)
    .parse(
      source
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== '')
    )

/**
 * #702: reads the lines of erasure-reapply-<stamp>.txt from stdin and
 * records each erasure again with its original request time
 * (operations/runbooks/recovery.v1.md). Without
 * ACCOUNT_ERASURE_REAPPLY_CONFIRM it only reports what it would do.
 */
export const runAccountErasureReapplyCommand = async (
  source: NodeJS.ProcessEnv,
  readLines: () => Promise<string>
): Promise<0 | 1> => {
  try {
    // The erasure command's target checks; its own confirmation is not this one.
    const input = parseSsoAccountErasureCommandInput({
      ...source,
      ACCOUNT_ERASURE_CONFIRM: 'ERASE_DELETION_PENDING_ACCOUNTS'
    })
    const apply = z
      .literal(REAPPLY_CONFIRMATION)
      .optional()
      .parse(source.ACCOUNT_ERASURE_REAPPLY_CONFIRM)
    const entries = parseReapplyEntries(await readLines())
    const database = createRoleDatabaseRuntime(input.databaseUrl, 'nihongo_app')
    let result
    try {
      result = await reapplyAccountErasures(
        database.client,
        entries,
        input.environment,
        apply !== undefined
      )
    } finally {
      await database.disconnect()
    }
    // The member's own request logs the same event, so a later restore can
    // re-apply this one too, again with the original time.
    if (apply) {
      // ISO strings in UTC sort by time: the latest, as the re-apply keeps.
      const requestedAt = new Map(
        entries
          .toSorted((a, b) => a.requestedAt.localeCompare(b.requestedAt))
          .map(({ userId, requestedAt }) => [userId, requestedAt])
      )
      for (const userId of result.requestedUserIds)
        process.stdout.write(
          `${JSON.stringify({ event: 'auth.account_erasure.requested', userId, occurredAt: requestedAt.get(userId), reason: 'REAPPLY' })}\n`
        )
    }
    process.stdout.write(
      `${JSON.stringify({
        event: 'auth.account_erasure.reapply',
        dryRun: !apply,
        listed: entries.length,
        requested: result.requestedUserIds.length,
        skipped: result.skippedUserIds,
        failed: result.failedUserIds
      })}\n`
    )
    return result.failedUserIds.length > 0 ? 1 : 0
  } catch {
    process.stderr.write(
      `${JSON.stringify({ event: 'auth.account_erasure.reapply_failed' })}\n`
    )
    return 1
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ quiet: true })
  void runAccountErasureReapplyCommand(process.env, () =>
    text(process.stdin)
  ).then((code) => {
    process.exitCode = code
  })
}

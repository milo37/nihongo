import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { createRoleDatabaseRuntime } from '../db/database.js'
import {
  REAPPLY_ERASURE_MAX_USERS,
  reapplyAccountErasures
} from './accountErasureAuthority.js'
import { parseSsoAccountErasureCommandInput } from './ssoAccountErasureCommand.js'

const REAPPLY_CONFIRMATION = 'REAPPLY_ACCOUNT_ERASURE'

/** One user id per line; blank lines are ignored, anything else fails. */
export const parseReapplyUserIds = (source: string): string[] =>
  z
    .array(z.uuid())
    .max(REAPPLY_ERASURE_MAX_USERS)
    .parse(
      source
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== '')
    )

/**
 * #702: reads the user ids of erasure-reapply-<stamp>.txt from stdin and
 * records their erasure again (operations/runbooks/recovery.v1.md). Without
 * ACCOUNT_ERASURE_REAPPLY_CONFIRM it only reports what it would do.
 */
export const runAccountErasureReapplyCommand = async (
  source: NodeJS.ProcessEnv,
  readIds: () => Promise<string>
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
    const userIds = parseReapplyUserIds(await readIds())
    const database = createRoleDatabaseRuntime(input.databaseUrl, 'nihongo_app')
    let result
    try {
      result = await reapplyAccountErasures(
        database.client,
        userIds,
        input.environment,
        apply !== undefined
      )
    } finally {
      await database.disconnect()
    }
    // The member's own request logs the same event, so a later restore can
    // re-apply this one too.
    if (apply)
      for (const userId of result.requestedUserIds)
        process.stdout.write(
          `${JSON.stringify({ event: 'auth.account_erasure.requested', userId, occurredAt: new Date().toISOString(), reason: 'REAPPLY' })}\n`
        )
    process.stdout.write(
      `${JSON.stringify({
        event: 'auth.account_erasure.reapply',
        dryRun: !apply,
        listed: userIds.length,
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

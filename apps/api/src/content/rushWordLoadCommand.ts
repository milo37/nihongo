import dotenv from 'dotenv'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  createOperatorDatabaseClient,
  runOperatorTransaction
} from '../db/operatorDatabase.js'
import {
  RUSH_WORD_ROWS_SQL,
  applyRushWordLoad,
  countRushWordSteps,
  parseRushWordList,
  planRushWordLoad,
  type RushWordRow
} from './rushWordList.js'

const inputSchema = z.object({
  RUSH_WORD_LIST_FILE: z.string().min(1),
  RUSH_WORD_LOAD_CONFIRM: z.literal('LOAD_RUSH_WORDS').optional()
})

const write = (
  stream: NodeJS.WriteStream,
  value: Record<string, unknown>
): void => {
  stream.write(`${JSON.stringify(value)}\n`)
}

/**
 * #1043: loads the rush word list from RUSH_WORD_LIST_FILE into
 * "RushKanjiWord" by source key, in one transaction. Without
 * RUSH_WORD_LOAD_CONFIRM it only reports what would change. Rows whose key
 * left the file are deleted. Prints one JSON line as the audit record.
 */
export const runRushWordLoadCommand = async (
  source: NodeJS.ProcessEnv
): Promise<void> => {
  try {
    const input = inputSchema.parse(source)
    const execute = input.RUSH_WORD_LOAD_CONFIRM !== undefined
    const list = parseRushWordList(await readFile(input.RUSH_WORD_LIST_FILE))
    // STAGING rehearses the PRODUCTION load, like the tag list (#659).
    const { client, environment } = createOperatorDatabaseClient(source, {
      allowStaging: true
    })
    const event = await runOperatorTransaction<Record<string, unknown>>(
      client,
      async (database) => {
        // "RushKanjiWord" belongs to nihongo_owner, like "Tag".
        await database.query('SET LOCAL ROLE nihongo_owner')
        await database.query(
          'SELECT "require_database_capability"($1::"AdminAuditEnvironment")',
          [environment]
        )
        await database.query(
          'LOCK TABLE "RushKanjiWord" IN SHARE ROW EXCLUSIVE MODE'
        )
        const rows = await database.query<RushWordRow>(RUSH_WORD_ROWS_SQL)
        const plan = planRushWordLoad(list, rows.rows)
        const summary = {
          environment,
          fileSha256: list.sha256,
          wordCount: list.words.length,
          created: countRushWordSteps(plan, 'create'),
          updated: countRushWordSteps(plan, 'update'),
          deleted: countRushWordSteps(plan, 'delete'),
          unchanged: plan.unchanged
        }
        if (!execute) {
          return {
            commit: false,
            value: { event: 'rush_word_list_dry_run', ...summary }
          }
        }
        await applyRushWordLoad(
          async (sql, values) =>
            (await database.query(sql, [...values])).rowCount ?? 0,
          plan
        )
        await database.query('SET LOCAL ROLE nihongo_migration')
        return {
          commit: true,
          value: {
            event: 'rush_word_list_loaded',
            ...summary,
            occurredAt: new Date().toISOString()
          }
        }
      }
    )
    write(process.stdout, event)
  } catch {
    write(process.stderr, { event: 'rush_word_list_load_failed' })
    process.exitCode = 1
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ quiet: true })
  void runRushWordLoadCommand(process.env)
}

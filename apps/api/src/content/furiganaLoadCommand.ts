import dotenv from 'dotenv'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  createOperatorDatabaseClient,
  runOperatorTransaction
} from '../db/operatorDatabase.js'
import {
  FURIGANA_PASSAGE_ROWS_SQL,
  applyFuriganaLoad,
  countFuriganaSteps,
  planFuriganaLoad,
  type FuriganaPassageRow
} from './furiganaLoad.js'
import { parseFuriganaPassageList } from './furiganaPassageList.js'

const inputSchema = z.object({
  FURIGANA_LIST_FILE: z.string().min(1),
  FURIGANA_LOAD_CONFIRM: z.literal('LOAD_FURIGANA').optional()
})

const write = (
  stream: NodeJS.WriteStream,
  value: Record<string, unknown>
): void => {
  stream.write(`${JSON.stringify(value)}\n`)
}

/**
 * #1182: loads the reviewed passage furigana of FURIGANA_LIST_FILE into
 * "Furigana" in one transaction. Without FURIGANA_LOAD_CONFIRM it only
 * reports what would change. Prints one JSON line as the audit record.
 */
export const runFuriganaLoadCommand = async (
  source: NodeJS.ProcessEnv
): Promise<void> => {
  try {
    const input = inputSchema.parse(source)
    const execute = input.FURIGANA_LOAD_CONFIRM !== undefined
    const bytes = await readFile(input.FURIGANA_LIST_FILE)
    const list = parseFuriganaPassageList(bytes)
    // STAGING rehearses the PRODUCTION load, like the rush words (#1043).
    const { client, environment } = createOperatorDatabaseClient(source, {
      allowStaging: true
    })
    const event = await runOperatorTransaction<Record<string, unknown>>(
      client,
      async (database) => {
        // "Furigana" belongs to nihongo_owner, like "RushKanjiWord".
        await database.query('SET LOCAL ROLE nihongo_owner')
        await database.query(
          'SELECT "require_database_capability"($1::"AdminAuditEnvironment")',
          [environment]
        )
        await database.query(
          'LOCK TABLE "Furigana" IN SHARE ROW EXCLUSIVE MODE'
        )
        const rows = await database.query<FuriganaPassageRow>(
          FURIGANA_PASSAGE_ROWS_SQL
        )
        const plan = planFuriganaLoad(list, rows.rows)
        const summary = {
          environment,
          fileSha256: createHash('sha256').update(bytes).digest('hex'),
          passageCount: list.passages.length,
          reviewed: plan.reviewed,
          missingPassage: plan.missingPassage,
          created: countFuriganaSteps(plan, 'create'),
          updated: countFuriganaSteps(plan, 'update'),
          deleted: countFuriganaSteps(plan, 'delete'),
          unchanged: plan.unchanged
        }
        if (!execute) {
          return {
            commit: false,
            value: { event: 'furigana_list_dry_run', ...summary }
          }
        }
        await applyFuriganaLoad(
          async (sql, values) =>
            (await database.query(sql, [...values])).rowCount ?? 0,
          plan
        )
        await database.query('SET LOCAL ROLE nihongo_migration')
        return {
          commit: true,
          value: {
            event: 'furigana_list_loaded',
            ...summary,
            occurredAt: new Date().toISOString()
          }
        }
      }
    )
    write(process.stdout, event)
  } catch {
    write(process.stderr, { event: 'furigana_list_load_failed' })
    process.exitCode = 1
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ quiet: true })
  void runFuriganaLoadCommand(process.env)
}

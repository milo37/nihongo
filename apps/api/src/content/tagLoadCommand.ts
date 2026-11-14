import dotenv from 'dotenv'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  createOperatorDatabaseClient,
  runOperatorTransaction
} from '../db/operatorDatabase.js'
import { parseTagList, planTagLoad } from './tagList.js'
import type { TagLoadStep, TagRow } from './tagList.js'

const inputSchema = z.object({
  TAG_LIST_FILE: z.string().min(1),
  TAG_LOAD_CONFIRM: z.literal('LOAD_TAG_LIST').optional()
})

const ROWS_SQL = `SELECT "id"::text AS "id", "key", "label", "normalizedName",
    "subject"::text AS "subject", "status"::text AS "status", "labelJa"
  FROM "Tag" ORDER BY "id"`

const UPDATE_SQL = `UPDATE "Tag" SET "key" = $2, "label" = $3,
    "normalizedName" = $4, "subject" = $5::"QuestionSubject",
    "status" = $6::"TagStatus", "labelJa" = $7,
    "updatedAt" = clock_timestamp()
  WHERE "id" = $1::uuid`

const INSERT_SQL = `INSERT INTO "Tag" ("id", "key", "label", "normalizedName",
    "subject", "status", "labelJa", "updatedAt")
  VALUES (gen_random_uuid(), $1, $2, $3, $4::"QuestionSubject",
    $5::"TagStatus", $6, clock_timestamp())`

const write = (
  stream: NodeJS.WriteStream,
  value: Record<string, unknown>
): void => {
  stream.write(`${JSON.stringify(value)}\n`)
}

const count = (steps: readonly TagLoadStep[], kind: TagLoadStep['kind']) =>
  steps.filter((step) => step.kind === kind).length

/**
 * Loads the fixed tag list from TAG_LIST_FILE into "Tag" by key. Without
 * TAG_LOAD_CONFIRM it only reports what would change. Tags missing from the
 * file are counted, never deleted. Prints one JSON line as the audit record.
 */
export const runTagLoadCommand = async (
  source: NodeJS.ProcessEnv
): Promise<void> => {
  try {
    const input = inputSchema.parse(source)
    const execute = input.TAG_LOAD_CONFIRM !== undefined
    const list = parseTagList(await readFile(input.TAG_LIST_FILE))
    // STAGING runs the PRODUCTION database contract, so its rehearsal loads
    // the same tag list as PRODUCTION, like the capability command (#648).
    const { client, environment } = createOperatorDatabaseClient(source, {
      allowStaging: true
    })
    const report = await runOperatorTransaction<
      { failed: boolean } & Record<string, unknown>
    >(client, async (database) => {
      // "Tag" belongs to nihongo_owner; the migration role writes it only as
      // its owner, like the first admin command reads "User".
      await database.query('SET LOCAL ROLE nihongo_owner')
      await database.query(
        'SELECT "require_database_capability"($1::"AdminAuditEnvironment")',
        [environment]
      )
      await database.query('LOCK TABLE "Tag" IN SHARE ROW EXCLUSIVE MODE')
      const rows = await database.query<TagRow>(ROWS_SQL)
      const plan = planTagLoad(list, rows.rows)
      const failed = execute && plan.conflicts.length > 0
      const summary = {
        environment,
        fileSha256: list.sha256,
        tagCount: list.tags.length,
        created: count(plan.steps, 'create'),
        updated: count(plan.steps, 'update'),
        claimed: count(plan.steps, 'claim'),
        unchanged: plan.unchanged,
        notInFile: plan.notInFile,
        unkeyed: plan.unkeyed,
        conflicts: plan.conflicts
      }
      if (!execute || failed) {
        return {
          commit: false,
          value: {
            failed,
            event: failed ? 'tag_list_load_failed' : 'tag_list_dry_run',
            ...summary
          }
        }
      }
      for (const step of plan.steps) {
        const { tag } = step
        const result =
          step.kind === 'create'
            ? await database.query(INSERT_SQL, [
                tag.key,
                tag.label,
                tag.normalizedName,
                tag.subject,
                tag.status,
                tag.labelJa
              ])
            : await database.query(UPDATE_SQL, [
                step.id,
                tag.key,
                tag.label,
                tag.normalizedName,
                tag.subject,
                tag.status,
                tag.labelJa
              ])
        if (result.rowCount !== 1) {
          throw new Error('TAG_LOAD_RESULT_INVALID')
        }
      }
      await database.query('SET LOCAL ROLE nihongo_migration')
      return {
        commit: true,
        value: {
          failed: false,
          event: 'tag_list_loaded',
          ...summary,
          occurredAt: new Date().toISOString()
        }
      }
    })
    const { failed, ...event } = report
    write(failed ? process.stderr : process.stdout, event)
    if (failed) process.exitCode = 1
  } catch {
    write(process.stderr, { event: 'tag_list_load_failed' })
    process.exitCode = 1
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ quiet: true })
  void runTagLoadCommand(process.env)
}

import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRoleDatabaseRuntime } from '../db/database.js'
import { parseStudyGuestCleanupCommandInput } from './studyGuestCleanupCommandInput.js'
import { verifyStudyGuestCleanupRole } from './studyGuestCleanupRole.js'
import { runGuestCleanupBatch } from './studyGuestCleanupBatch.js'
import { runStudyGuestCleanup } from './studyGuestCleanupRunner.js'

export const runStudyGuestCleanupCommand = async (
  source: NodeJS.ProcessEnv
): Promise<0 | 1> => {
  try {
    const input = parseStudyGuestCleanupCommandInput(source)
    const startedAt = performance.now()
    const database = createRoleDatabaseRuntime(input.databaseUrl, 'nihongo_app')
    try {
      const roleBudget = Math.floor(
        (input.maxDurationMs - (performance.now() - startedAt)) / 2
      )
      if (roleBudget < 1)
        throw new Error('Guest cleanup time budget exhausted.')
      await database.client.$transaction(
        async (transaction) => await verifyStudyGuestCleanupRole(transaction),
        { maxWait: roleBudget, timeout: roleBudget }
      )
      const remainingMs = Math.floor(
        input.maxDurationMs - (performance.now() - startedAt)
      )
      if (remainingMs < 1)
        throw new Error('Guest cleanup time budget exhausted.')
      const batch = async (
        dryRun: boolean,
        batchSize: number,
        timeoutMs: number
      ) => {
        const limit = Math.floor(timeoutMs / 2)
        if (limit < 1) throw new Error('Guest cleanup time budget exhausted.')
        const result = await database.client.$transaction(
          async (transaction) =>
            await runGuestCleanupBatch(transaction, { batchSize, dryRun }),
          { maxWait: limit, timeout: limit }
        )
        return { ...result, remainingCount: result.eligibleCount }
      }
      const result = await runStudyGuestCleanup(
        { ...input, maxDurationMs: remainingMs },
        {
          now: () => performance.now(),
          preview: async (timeoutMs) =>
            await batch(true, input.batchSize, timeoutMs),
          executeBatch: async ({ batchSize, timeoutMs }) =>
            await batch(false, batchSize, timeoutMs)
        }
      )
      process.stdout.write(
        `${JSON.stringify({ event: 'study.guest_cleanup.ran', dryRun: input.dryRun, ...result })}\n`
      )
      return !input.dryRun && result.hasMore ? 1 : 0
    } finally {
      await database.disconnect()
    }
  } catch {
    process.stderr.write(
      `${JSON.stringify({ event: 'study.guest_cleanup.failed' })}\n`
    )
    return 1
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ quiet: true })
  void runStudyGuestCleanupCommand(process.env).then((code) => {
    process.exitCode = code
  })
}

import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { createAuthRuntimePlan } from '../config/authRuntimePlan.js'
import { createDatabaseRuntime } from '../db/database.js'
import { createOperatorDatabaseClient } from '../db/operatorDatabase.js'
import { ApplicationError } from '../errors/applicationError.js'
import {
  publishQuestionSet,
  QuestionSetInputError,
  readQuestionSet
} from './questionSetPublish.js'

const inputSchema = z.object({
  QUESTION_SET_DIR: z.string().min(1),
  QUESTION_SET_CONFIRM: z.literal('PUBLISH_QUESTION_SET').optional()
})

const write = (
  stream: NodeJS.WriteStream,
  value: Record<string, unknown>
): void => {
  stream.write(`${JSON.stringify(value)}\n`)
}

/**
 * Publishes the fixed 500 question set from QUESTION_SET_DIR as the one ACTIVE
 * ADMIN, without a login (JLP-828). Without QUESTION_SET_CONFIRM it only
 * plans. The target is checked like the tag list load; the commands run on the
 * application login like the admin screen. Prints one JSON line with no email,
 * secret or database URL.
 */
export const runQuestionSetPublishCommand = async (
  source: NodeJS.ProcessEnv
): Promise<void> => {
  let disconnect = async (): Promise<void> => undefined
  try {
    const input = inputSchema.parse(source)
    const execute = input.QUESTION_SET_CONFIRM !== undefined
    const files = await readQuestionSet(input.QUESTION_SET_DIR)
    // Validates the deployment and database target only; the operator
    // client itself is never connected.
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
    const report = await publishQuestionSet({
      auditEnvironment: environment,
      client: database.client,
      execute,
      files
    })
    const failed =
      report.conflicts.length > 0 ||
      report.issues.length > 0 ||
      report.failures.length > 0
    write(failed ? process.stderr : process.stdout, {
      event: failed
        ? 'question_set_publish_failed'
        : execute
          ? 'question_set_published'
          : 'question_set_dry_run',
      environment,
      ...report
    })
    if (failed) process.exitCode = 1
  } catch (error: unknown) {
    write(process.stderr, {
      event: 'question_set_publish_failed',
      code:
        error instanceof QuestionSetInputError ||
        error instanceof ApplicationError
          ? error.code
          : 'QUESTION_SET_PUBLISH_FAILED'
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
  void runQuestionSetPublishCommand(process.env)
}

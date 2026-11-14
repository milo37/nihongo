import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { createAuthRuntimePlan } from '../config/authRuntimePlan.js'
import { createDatabaseRuntime } from '../db/database.js'
import { createOperatorDatabaseClient } from '../db/operatorDatabase.js'
import { ApplicationError } from '../errors/applicationError.js'
import {
  publishExplanationJa,
  readExplanationJaFile
} from './explanationJaPublish.js'
import { QuestionSetInputError, readQuestionSet } from './questionSetPublish.js'

const inputSchema = z.object({
  QUESTION_SET_DIR: z.string().min(1),
  QUESTION_SET_PREVIOUS_DIR: z.string().min(1).optional(),
  EXPLANATION_JA_FILE: z.string().min(1),
  EXPLANATION_JA_CONFIRM: z.literal('PUBLISH_EXPLANATION_JA').optional()
})

const write = (
  stream: NodeJS.WriteStream,
  value: Record<string, unknown>
): void => {
  stream.write(`${JSON.stringify(value)}\n`)
}

/**
 * Publishes a new version of each question in EXPLANATION_JA_FILE with its
 * Japanese explanation, as the one ACTIVE ADMIN without a login (#976). The
 * set files in QUESTION_SET_DIR locate each question; the optional
 * QUESTION_SET_PREVIOUS_DIR holds the set as it was published, for questions
 * whose text the set changed since. Without
 * EXPLANATION_JA_CONFIRM it only plans. The target is checked like the tag list load; the commands run on the
 * application login like the admin screen. Prints one JSON line with no email,
 * secret or database URL.
 */
export const runExplanationJaPublishCommand = async (
  source: NodeJS.ProcessEnv
): Promise<void> => {
  let disconnect = async (): Promise<void> => undefined
  try {
    const input = inputSchema.parse(source)
    const execute = input.EXPLANATION_JA_CONFIRM !== undefined
    const files = await readQuestionSet(input.QUESTION_SET_DIR)
    const previousFiles =
      input.QUESTION_SET_PREVIOUS_DIR === undefined
        ? undefined
        : await readQuestionSet(input.QUESTION_SET_PREVIOUS_DIR)
    const explanations = await readExplanationJaFile(input.EXPLANATION_JA_FILE)
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
    const report = await publishExplanationJa({
      auditEnvironment: environment,
      client: database.client,
      execute,
      explanations,
      files,
      previousFiles
    })
    const failed = report.conflicts.length > 0 || report.failures.length > 0
    write(failed ? process.stderr : process.stdout, {
      event: failed
        ? 'explanation_ja_publish_failed'
        : execute
          ? 'explanation_ja_published'
          : 'explanation_ja_dry_run',
      environment,
      ...report
    })
    if (failed) process.exitCode = 1
  } catch (error: unknown) {
    write(process.stderr, {
      event: 'explanation_ja_publish_failed',
      code:
        error instanceof QuestionSetInputError ||
        error instanceof ApplicationError
          ? error.code
          : 'EXPLANATION_JA_PUBLISH_FAILED'
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
  void runExplanationJaPublishCommand(process.env)
}

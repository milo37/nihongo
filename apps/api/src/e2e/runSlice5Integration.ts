import { randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { Client } from 'pg'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { assertSlice5IntegrationWarningBudget } from './integrationWarningBudget.js'
import {
  shouldDetachOwnedProcess,
  stopOwnedProcesses
} from './ownedProcessGroup.js'

const SCHEMA_PATTERN = /^phase4_slice5_integration_[0-9]+_[a-f0-9]{8}_test$/
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
)

dotenv.config({
  path: path.join(repositoryRoot, 'apps/api/.env.test'),
  override: true,
  quiet: true
})

const baseDatabaseUrl =
  process.env.SLICE5_INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL

assertSafeTestDatabase({
  nodeEnvironment: 'test',
  databaseUrl: baseDatabaseUrl,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

if (!baseDatabaseUrl) {
  throw new Error('Slice 5 integration requires a test PostgreSQL URL.')
}

const schemaName =
  `phase4_slice5_integration_${Date.now()}_` +
  `${randomBytes(4).toString('hex')}_test`
const integrationTestArguments = process.argv
  .slice(2)
  .filter((argument, index) => !(index === 0 && argument === '--'))
if (!SCHEMA_PATTERN.test(schemaName)) {
  throw new Error('Generated Slice 5 integration schema is unsafe.')
}

const adminDatabaseUrl = new URL(baseDatabaseUrl)
adminDatabaseUrl.searchParams.delete('schema')
const targetDatabaseUrl = new URL(adminDatabaseUrl)
targetDatabaseUrl.searchParams.set('schema', schemaName)

const quoteIdentifier = (value: string): string => {
  if (!SCHEMA_PATTERN.test(value)) {
    throw new Error('Refusing to quote an unexpected integration schema name.')
  }
  return `"${value}"`
}

const formatCommand = (command: string, args: readonly string[]): string =>
  [command, ...args].join(' ')

const commandProcesses: Array<{ child: ChildProcess; label: string }> = []

const runCommand = async (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  captureIntegrationOutput = false
): Promise<string> =>
  await new Promise<string>((resolve, reject) => {
    let capturedOutput = ''
    let spawnError: Error | undefined
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      detached: shouldDetachOwnedProcess,
      env: environment,
      stdio: captureIntegrationOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit'
    })
    commandProcesses.push({ child, label: formatCommand(command, args) })
    if (captureIntegrationOutput) {
      child.stdout?.on('data', (chunk: Buffer) => {
        const value = chunk.toString()
        capturedOutput += value
        process.stdout.write(value)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        const value = chunk.toString()
        capturedOutput += value
        process.stderr.write(value)
      })
    }
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code, signal) => {
      if (spawnError) {
        reject(spawnError)
        return
      }
      if (code === 0) {
        resolve(capturedOutput)
        return
      }
      reject(
        new Error(
          `${formatCommand(command, args)} failed (` +
            `${signal ?? `exit ${code ?? 'unknown'}`}).`
        )
      )
    })
  })

const createSchema = async (client: Client): Promise<void> => {
  const existing = await client.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM pg_namespace WHERE nspname = $1',
    [schemaName]
  )
  if (existing.rows[0]?.count !== '0') {
    throw new Error('Generated Slice 5 integration schema already exists.')
  }
  await client.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`)
}

const dropSchema = async (client: Client): Promise<void> => {
  await client.query(
    `DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`
  )
  const remaining = await client.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM pg_namespace WHERE nspname = $1',
    [schemaName]
  )
  if (remaining.rows[0]?.count !== '0') {
    throw new Error('Slice 5 integration schema cleanup verification failed.')
  }
}

const adminClient = new Client({
  connectionString: adminDatabaseUrl.toString()
})
let adminConnected = false
let cleanupPromise: Promise<void> | undefined
let schemaCreated = false

const cleanup = (): Promise<void> => {
  cleanupPromise ??= (async () => {
    await stopOwnedProcesses(commandProcesses, {
      onForceKill: ({ label }) => {
        process.stderr.write(
          `[${label}] graceful stop timed out; sending SIGKILL.\n`
        )
      }
    })
    commandProcesses.length = 0
    try {
      if (schemaCreated && adminConnected) {
        await dropSchema(adminClient)
        schemaCreated = false
        process.stdout.write(
          `${JSON.stringify({
            event: 'slice5.integration.schema_removed',
            schemaName
          })}\n`
        )
      }
    } finally {
      if (adminConnected) {
        await adminClient.end()
        adminConnected = false
      }
    }
  })()
  return cleanupPromise
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void cleanup()
      .then(() => process.exit(signal === 'SIGINT' ? 130 : 143))
      .catch(() => process.exit(1))
  })
}

const run = async (): Promise<void> => {
  await adminClient.connect()
  adminConnected = true
  await createSchema(adminClient)
  schemaCreated = true
  process.stdout.write(
    `${JSON.stringify({
      event: 'slice5.integration.schema_created',
      schemaName
    })}\n`
  )

  const integrationEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PRISMA_TEST_DATABASE_URL: targetDatabaseUrl.toString()
  }
  const tracedIntegrationEnvironment: NodeJS.ProcessEnv = {
    ...integrationEnvironment,
    NODE_OPTIONS: [integrationEnvironment.NODE_OPTIONS, '--trace-deprecation']
      .filter(Boolean)
      .join(' ')
  }
  const historicalPinEnvironment: NodeJS.ProcessEnv = {
    ...tracedIntegrationEnvironment,
    RUN_SLICE5_HISTORICAL_PIN_TEST: '1'
  }
  const seedEnvironment: NodeJS.ProcessEnv = {
    ...integrationEnvironment,
    SEED_TARGET: 'test'
  }

  await runCommand('pnpm', ['run', 'build:contracts'])
  await runCommand('pnpm', ['run', 'build:domain'])
  await runCommand('pnpm', ['--filter', '@nihongo/api', 'run', 'db:generate'])
  await runCommand(
    'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:migrate:test'],
    integrationEnvironment
  )
  await runCommand(
    'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:seed:test'],
    seedEnvironment
  )
  await runCommand(
    'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:seed:test'],
    seedEnvironment
  )
  const fullSuiteOutput = await runCommand(
    'pnpm',
    integrationTestArguments.length > 0
      ? [
          '--filter',
          '@nihongo/api',
          'exec',
          'vitest',
          'run',
          '--config',
          'vitest.integration.config.ts',
          ...integrationTestArguments
        ]
      : ['--filter', '@nihongo/api', 'run', 'test:integration'],
    integrationTestArguments.length > 0
      ? historicalPinEnvironment
      : tracedIntegrationEnvironment,
    integrationTestArguments.length === 0
  )
  if (integrationTestArguments.length === 0) {
    const historicalPinOutput = await runCommand(
      'pnpm',
      [
        '--filter',
        '@nihongo/api',
        'exec',
        'vitest',
        'run',
        '--config',
        'vitest.integration.config.ts',
        'src/study/studyResultRetry.integration.test.ts',
        '-t',
        'source v1을 retire하고 v2를 publish해도 retry와 ReviewEvent는 v1 pin을 보존한다'
      ],
      historicalPinEnvironment,
      true
    )
    assertSlice5IntegrationWarningBudget(fullSuiteOutput, historicalPinOutput)
    process.stdout.write(
      `${JSON.stringify({
        event: 'slice5.integration.pg_warning_budget_verified',
        warningCount: 8
      })}\n`
    )
  }
}

void run()
  .then(async () => {
    await cleanup()
  })
  .catch(async (error: unknown) => {
    try {
      await cleanup()
    } catch (cleanupError: unknown) {
      process.stderr.write(
        `${JSON.stringify({
          event: 'slice5.integration.cleanup_failed',
          errorName:
            cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
          schemaName
        })}\n`
      )
    }
    process.stderr.write(
      `${JSON.stringify({
        event: 'slice5.integration.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : 'Unknown failure',
        schemaName
      })}\n`
    )
    process.exitCode = 1
  })

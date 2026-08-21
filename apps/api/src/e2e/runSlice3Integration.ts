import { randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { Client } from 'pg'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'

const SCHEMA_PATTERN = /^phase4_slice3_integration_[0-9]+_[a-f0-9]{8}_test$/
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
  process.env.SLICE3_INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL

assertSafeTestDatabase({
  nodeEnvironment: 'test',
  databaseUrl: baseDatabaseUrl,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

if (!baseDatabaseUrl) {
  throw new Error('Slice 3 integration requires a test PostgreSQL URL.')
}

const schemaName =
  `phase4_slice3_integration_${Date.now()}_` +
  `${randomBytes(4).toString('hex')}_test`
const integrationTestArguments = process.argv
  .slice(2)
  .filter((argument, index) => !(index === 0 && argument === '--'))
if (!SCHEMA_PATTERN.test(schemaName)) {
  throw new Error('Generated Slice 3 integration schema is unsafe.')
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

let activeChild: ChildProcess | undefined

const runCommand = async (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: 'inherit'
    })
    activeChild = child
    child.once('error', (error) => {
      if (activeChild === child) {
        activeChild = undefined
      }
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (activeChild === child) {
        activeChild = undefined
      }
      if (code === 0) {
        resolve()
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

const stopActiveChild = async (): Promise<void> => {
  const child = activeChild
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return
  }
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => {
      child.once('exit', () => resolve(true))
    }),
    delay(8_000).then(() => false)
  ])
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
  }
}

const createSchema = async (client: Client): Promise<void> => {
  const existing = await client.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM pg_namespace WHERE nspname = $1',
    [schemaName]
  )
  if (existing.rows[0]?.count !== '0') {
    throw new Error('Generated Slice 3 integration schema already exists.')
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
    throw new Error('Slice 3 integration schema cleanup verification failed.')
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
    await stopActiveChild()
    try {
      if (schemaCreated && adminConnected) {
        await dropSchema(adminClient)
        schemaCreated = false
        process.stdout.write(
          `${JSON.stringify({
            event: 'slice3.integration.schema_removed',
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
      event: 'slice3.integration.schema_created',
      schemaName
    })}\n`
  )

  const integrationEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PRISMA_TEST_DATABASE_URL: targetDatabaseUrl.toString()
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
  await runCommand(
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
    integrationEnvironment
  )
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
          event: 'slice3.integration.cleanup_failed',
          errorName:
            cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
          schemaName
        })}\n`
      )
    }
    process.stderr.write(
      `${JSON.stringify({
        event: 'slice3.integration.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : 'Unknown failure',
        schemaName
      })}\n`
    )
    process.exitCode = 1
  })

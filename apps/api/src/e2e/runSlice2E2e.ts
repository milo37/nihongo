import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { hashPassword } from 'better-auth/crypto'
import dotenv from 'dotenv'
import { Client } from 'pg'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { createDatabaseRuntime } from '../db/database.js'

const API_PORT = 3001
const WEB_PORT = 5173
const MOCK_WEB_PORT = 5174
const SCHEMA_PATTERN = /^phase4_slice2_e2e_[0-9]+_[a-f0-9]{8}_test$/
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
)

interface RunningCommand {
  child: ChildProcess
  label: string
}

interface UserFixture {
  email: string
  name: string
  password: string
  userId: string
}

dotenv.config({
  path: path.join(repositoryRoot, 'apps/api/.env.test'),
  override: true,
  quiet: true
})

const baseDatabaseUrl =
  process.env.SLICE2_E2E_DATABASE_URL ?? process.env.DATABASE_URL

assertSafeTestDatabase({
  nodeEnvironment: 'test',
  databaseUrl: baseDatabaseUrl,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

if (!baseDatabaseUrl) {
  throw new Error('Slice 2 E2E requires a test PostgreSQL URL.')
}

const schemaName = `phase4_slice2_e2e_${Date.now()}_${randomBytes(4).toString('hex')}_test`
const playwrightArguments = process.argv
  .slice(2)
  .filter((argument, index) => !(index === 0 && argument === '--'))
if (!SCHEMA_PATTERN.test(schemaName)) {
  throw new Error('Generated Slice 2 E2E schema is unsafe.')
}

const adminDatabaseUrl = new URL(baseDatabaseUrl)
adminDatabaseUrl.searchParams.delete('schema')
const targetDatabaseUrl = new URL(adminDatabaseUrl)
targetDatabaseUrl.searchParams.set('schema', schemaName)

const quoteIdentifier = (value: string): string => {
  if (!SCHEMA_PATTERN.test(value)) {
    throw new Error('Refusing to quote an unexpected E2E schema name.')
  }
  return `"${value}"`
}

const formatCommand = (command: string, args: readonly string[]): string =>
  [command, ...args].join(' ')

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
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `${formatCommand(command, args)} failed (${signal ?? `exit ${code ?? 'unknown'}`}).`
        )
      )
    })
  })

const startCommand = (
  label: string,
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv
): RunningCommand => {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[${label}] ${chunk.toString()}`)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[${label}] ${chunk.toString()}`)
  })

  return { child, label }
}

const stopCommand = async ({ child, label }: RunningCommand): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
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
    process.stderr.write(
      `[${label}] graceful stop timed out; sending SIGKILL.\n`
    )
    child.kill('SIGKILL')
  }
}

const waitForHttp = async (url: string, label: string): Promise<void> => {
  const deadline = Date.now() + 45_000
  let lastStatus: number | undefined
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' })
      lastStatus = response.status
      if (response.ok) {
        return
      }
    } catch {
      // The owned listener has not opened yet.
    }
    await delay(250)
  }
  throw new Error(
    `${label} did not become ready${lastStatus ? ` (last status ${lastStatus})` : ''}.`
  )
}

const createUserFixtures = async (): Promise<
  readonly [UserFixture, UserFixture, UserFixture, UserFixture]
> => {
  const suffix = schemaName.slice(-21, -5)
  const fixtures: readonly [
    UserFixture,
    UserFixture,
    UserFixture,
    UserFixture
  ] = [
    {
      email: `slice2-a-${suffix}@example.test`,
      name: 'Slice 2 학습자 A',
      password: `Slice2-A-${randomBytes(16).toString('base64url')}!9a`,
      userId: randomUUID()
    },
    {
      email: `slice2-b-${suffix}@example.test`,
      name: 'Slice 2 학습자 B',
      password: `Slice2-B-${randomBytes(16).toString('base64url')}!9a`,
      userId: randomUUID()
    },
    {
      email: `slice2-c-${suffix}@example.test`,
      name: 'Slice 2 학습자 C',
      password: `Slice2-C-${randomBytes(16).toString('base64url')}!9a`,
      userId: randomUUID()
    },
    {
      email: `slice2-d-${suffix}@example.test`,
      name: 'Slice 2 학습자 D',
      password: `Slice2-D-${randomBytes(16).toString('base64url')}!9a`,
      userId: randomUUID()
    }
  ]
  const database = createDatabaseRuntime(targetDatabaseUrl.toString())

  try {
    await database.checkReadiness()
    for (const fixture of fixtures) {
      const password = await hashPassword(fixture.password)
      await database.client.$transaction(async (transaction) => {
        await transaction.user.create({
          data: {
            accountStatus: 'ACTIVE',
            email: fixture.email,
            emailVerified: true,
            id: fixture.userId,
            name: fixture.name,
            role: 'USER',
            targetLevel: 'N5'
          }
        })
        await transaction.account.create({
          data: {
            accountId: fixture.userId,
            password,
            providerId: 'credential',
            userId: fixture.userId
          }
        })
      })
    }
  } finally {
    await database.disconnect()
  }

  return fixtures
}

const createSchema = async (client: Client): Promise<void> => {
  const existing = await client.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM pg_namespace WHERE nspname = $1',
    [schemaName]
  )
  if (existing.rows[0]?.count !== '0') {
    throw new Error('Generated Slice 2 E2E schema already exists.')
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
    throw new Error('Slice 2 E2E schema cleanup verification failed.')
  }
}

const apiEnvironment = (databaseUrl: string): NodeJS.ProcessEnv => ({
  ...process.env,
  AUTH_EMAIL_DELIVERY_MODE: 'test-sink',
  AUTH_EMAIL_FROM: 'auth@example.test',
  AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
  BETTER_AUTH_SECRET: 'slice2-e2e-auth-secret-not-for-production-2026',
  BETTER_AUTH_URL: `http://127.0.0.1:${API_PORT}`,
  DATABASE_URL: databaseUrl,
  GUEST_COOKIE_SECRET: 'slice2-e2e-guest-secret-distinct-2026-value',
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  PORT: String(API_PORT),
  PRACTICE_CONTRACT_RUNTIME: 'v1-v2',
  TRUSTED_ORIGINS: `http://127.0.0.1:${WEB_PORT}`
})

const adminClient = new Client({
  connectionString: adminDatabaseUrl.toString()
})
const runningCommands: RunningCommand[] = []
let cleanupPromise: Promise<void> | undefined
let schemaCreated = false

const cleanup = (): Promise<void> => {
  cleanupPromise ??= (async () => {
    for (const command of [...runningCommands].reverse()) {
      await stopCommand(command)
    }
    runningCommands.length = 0

    if (schemaCreated) {
      await dropSchema(adminClient)
      schemaCreated = false
      process.stdout.write(
        `${JSON.stringify({ event: 'slice2.e2e.schema_removed', schemaName })}\n`
      )
    }
    await adminClient.end()
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
  await createSchema(adminClient)
  schemaCreated = true
  process.stdout.write(
    `${JSON.stringify({ event: 'slice2.e2e.schema_created', schemaName })}\n`
  )

  const migrationEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PRISMA_TEST_DATABASE_URL: targetDatabaseUrl.toString()
  }
  await runCommand('pnpm', ['run', 'build:contracts'])
  await runCommand('pnpm', ['run', 'build:domain'])
  await runCommand('pnpm', ['--filter', '@nihongo/api', 'run', 'db:generate'])
  await runCommand(
    'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:migrate:test'],
    migrationEnvironment
  )
  await runCommand(
    'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:seed:test'],
    migrationEnvironment
  )
  await runCommand(
    'pnpm',
    ['--filter', '@nihongo/api', 'run', 'db:seed:test'],
    migrationEnvironment
  )
  const [userA, userB, userC, userD] = await createUserFixtures()

  const api = startCommand(
    'api',
    'pnpm',
    ['--filter', '@nihongo/api', 'exec', 'tsx', 'src/server.ts'],
    apiEnvironment(targetDatabaseUrl.toString())
  )
  runningCommands.push(api)
  await waitForHttp(`http://127.0.0.1:${API_PORT}/health/ready`, 'Slice 2 API')

  const web = startCommand(
    'web',
    'pnpm',
    [
      '--filter',
      '@nihongo/web',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(WEB_PORT),
      '--strictPort'
    ],
    { ...process.env, VITE_API_MODE: 'real' }
  )
  runningCommands.push(web)
  await waitForHttp(`http://127.0.0.1:${WEB_PORT}`, 'Slice 2 web')

  const mockWeb = startCommand(
    'mock-web',
    'pnpm',
    [
      '--filter',
      '@nihongo/web',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(MOCK_WEB_PORT),
      '--strictPort'
    ],
    { ...process.env, VITE_API_MODE: 'mock' }
  )
  runningCommands.push(mockWeb)
  await waitForHttp(`http://127.0.0.1:${MOCK_WEB_PORT}`, 'Slice 2 mock web')

  await runCommand(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '--config',
      'playwright.config.ts',
      'apps/web/e2e/slice2-practice-flow.spec.ts',
      ...playwrightArguments
    ],
    {
      ...process.env,
      E2E_USER_A_EMAIL: userA.email,
      E2E_USER_A_NAME: userA.name,
      E2E_USER_A_PASSWORD: userA.password,
      E2E_USER_B_EMAIL: userB.email,
      E2E_USER_B_NAME: userB.name,
      E2E_USER_B_PASSWORD: userB.password,
      E2E_USER_C_EMAIL: userC.email,
      E2E_USER_C_NAME: userC.name,
      E2E_USER_C_PASSWORD: userC.password,
      E2E_USER_D_EMAIL: userD.email,
      E2E_USER_D_NAME: userD.name,
      E2E_USER_D_PASSWORD: userD.password,
      PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${WEB_PORT}`,
      PLAYWRIGHT_OUTPUT_LABEL: 'real',
      SLICE2_E2E_SCHEMA: schemaName
    }
  )

  await runCommand(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '--config',
      'playwright.config.ts',
      'apps/web/e2e/slice2-practice-mock.spec.ts',
      ...playwrightArguments
    ],
    {
      ...process.env,
      PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${MOCK_WEB_PORT}`,
      PLAYWRIGHT_OUTPUT_LABEL: 'mock'
    }
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
          event: 'slice2.e2e.cleanup_failed',
          errorName:
            cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
          schemaName
        })}\n`
      )
    }
    process.stderr.write(
      `${JSON.stringify({
        event: 'slice2.e2e.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : 'Unknown failure',
        schemaName
      })}\n`
    )
    process.exitCode = 1
  })

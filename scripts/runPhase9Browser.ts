import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import nodePath from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type { Phase7BrowserFixtureDatabase } from '../apps/api/src/e2e/phase7BrowserFixture.js'
import {
  retireOwnedProcess,
  shouldDetachOwnedProcess,
  stopOwnedProcesses
} from '../apps/api/src/e2e/ownedProcessGroup.js'

const repositoryRoot = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  '..'
)

interface ManagedProcess {
  readonly child: ChildProcess
  readonly label: string
  spawnError: Error | undefined
}

interface Phase9DatabaseSnapshot {
  readonly rateLimitRows: ReadonlyArray<{
    readonly count: number
    readonly key: string
  }>
  readonly tableNames: readonly string[]
  readonly tables: Readonly<
    Record<string, { readonly count: number; readonly fingerprint: string }>
  >
}

interface Phase9DatabaseEvidence {
  readonly actorState: unknown
  readonly rateLimitCategories: Readonly<Record<string, number>>
  readonly tableDeltas: Readonly<Record<string, number>>
  readonly zeroDeltaFingerprintsVerified: number
}

interface Phase9DatabaseContractModule {
  readonly assertPhase9DatabaseContract: (input: {
    readonly before: Phase9DatabaseSnapshot
    readonly databaseUrl: string
    readonly fixture: unknown
  }) => Promise<Phase9DatabaseEvidence>
  readonly capturePhase9DatabaseSnapshot: (
    databaseUrl: string
  ) => Promise<Phase9DatabaseSnapshot>
}

type BrowserMode = 'mock' | 'real'

const [rawMode, ...rawPlaywrightArguments] = process.argv.slice(2)
const mode: BrowserMode | undefined =
  rawMode === 'mock' || rawMode === 'real' ? rawMode : undefined
const playwrightArguments = rawPlaywrightArguments.filter(
  (argument, index) => !(index === 0 && argument === '--')
)
const ownedProcesses: ManagedProcess[] = []
let fixtureDatabase: Phase7BrowserFixtureDatabase | undefined
let cleanupDatabaseHarness: (() => Promise<void>) | undefined
let cleanupPromise: Promise<void> | undefined

const formatCommand = (command: string, args: readonly string[]): string =>
  [command, ...args].join(' ')

const spawnOwned = (
  label: string,
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv
): ManagedProcess => {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    detached: shouldDetachOwnedProcess,
    env: environment,
    stdio: ['ignore', 'inherit', 'inherit']
  })
  const ownedProcess: ManagedProcess = {
    child,
    label,
    spawnError: undefined
  }
  child.once('error', (error) => {
    ownedProcess.spawnError = error
  })
  ownedProcesses.push(ownedProcess)
  return ownedProcess
}

const runCommand = async (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const ownedProcess = spawnOwned(
      formatCommand(command, args),
      command,
      args,
      environment
    )
    ownedProcess.child.once('close', (code, signal) => {
      void retireOwnedProcess(ownedProcesses, ownedProcess).then(
        () => {
          if (ownedProcess.spawnError) {
            reject(ownedProcess.spawnError)
            return
          }
          if (code === 0) {
            resolve()
            return
          }
          reject(
            new Error(
              `${ownedProcess.label} failed (${signal ?? `exit ${code ?? 'unknown'}`}).`
            )
          )
        },
        (error: unknown) => reject(error)
      )
    })
  })
}

const waitForHttp = async (
  url: string,
  ownedProcess: ManagedProcess
): Promise<void> => {
  const deadline = Date.now() + 45_000
  let lastStatus: number | undefined

  while (Date.now() < deadline) {
    if (ownedProcess.spawnError) throw ownedProcess.spawnError
    if (
      ownedProcess.child.exitCode !== null ||
      ownedProcess.child.signalCode !== null
    ) {
      throw new Error(`${ownedProcess.label} exited before becoming ready.`)
    }
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(2_000)
      })
      lastStatus = response.status
      await response.arrayBuffer()
      if (response.ok) return
    } catch {
      // The owned listener has not opened yet.
    }
    await delay(250)
  }

  throw new Error(
    `${ownedProcess.label} did not become ready${
      lastStatus ? ` (last status ${lastStatus})` : ''
    }.`
  )
}

const reserveLoopbackPort = async (): Promise<number> =>
  await new Promise<number>((resolve, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo | null
      if (!address) {
        server.close(() => reject(new Error('Dynamic port lookup failed.')))
        return
      }
      server.close((error) => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })

const cleanup = (): Promise<void> => {
  cleanupPromise ??= (async () => {
    const errors: unknown[] = []
    let processesStopped = false

    try {
      await stopOwnedProcesses(ownedProcesses, {
        onForceKill: ({ label }) => {
          process.stderr.write(
            `[${label}] graceful stop timed out; sending SIGKILL.\n`
          )
        }
      })
      ownedProcesses.length = 0
      processesStopped = true
    } catch (error: unknown) {
      errors.push(error)
    }

    if (!processesStopped) {
      errors.push(
        new Error(
          'Phase 9 database cleanup was withheld because an owned process may still be running.'
        )
      )
    } else {
      if (fixtureDatabase) {
        try {
          await fixtureDatabase.disconnect()
        } catch (error: unknown) {
          errors.push(error)
        }
        fixtureDatabase = undefined
      }

      if (cleanupDatabaseHarness) {
        try {
          await cleanupDatabaseHarness()
        } catch (error: unknown) {
          errors.push(error)
        }
        cleanupDatabaseHarness = undefined
      }
    }

    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Phase 9 browser cleanup failed.')
    }
  })()
  return cleanupPromise
}

const runPlaywright = async (
  browserMode: BrowserMode,
  webOrigin: string,
  extraEnvironment: NodeJS.ProcessEnv = {}
): Promise<void> => {
  await runCommand(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '--config',
      'playwright.config.ts',
      'apps/web/e2e/phase9-accessibility.spec.ts',
      ...playwrightArguments
    ],
    {
      ...process.env,
      ...extraEnvironment,
      PHASE9_BROWSER_MODE: browserMode,
      PLAYWRIGHT_BASE_URL: webOrigin,
      PLAYWRIGHT_OUTPUT_LABEL: `phase9-${browserMode}`
    }
  )
}

const runMock = async (): Promise<void> => {
  await runCommand('pnpm', ['run', 'build:contracts'])
  await runCommand('pnpm', ['run', 'build:domain'])

  const webPort = await reserveLoopbackPort()
  const webOrigin = `http://127.0.0.1:${webPort}`
  const web = spawnOwned(
    'phase9-mock-web',
    'pnpm',
    [
      '--filter',
      '@nihongo/web',
      'exec',
      'vite',
      '--mode',
      'test',
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
      '--strictPort'
    ],
    {
      ...process.env,
      VITE_API_BASE_URL: '/api',
      VITE_API_MODE: 'mock'
    }
  )
  await waitForHttp(webOrigin, web)
  await runPlaywright('mock', webOrigin)
}

const runReal = async (): Promise<void> => {
  const { cleanupPhase7IsolatedDatabase, preparePhase7IsolatedDatabase } =
    await import('../apps/api/src/e2e/runPhase7ApiIntegration.js')
  cleanupDatabaseHarness = cleanupPhase7IsolatedDatabase
  const harness = await preparePhase7IsolatedDatabase({ seedRuns: 2 })
  const { createPhase7BrowserFixture } = await import(
    '../apps/api/src/e2e/phase7BrowserFixture.js'
  )
  const created = await createPhase7BrowserFixture(harness.adminDatabaseUrl)
  fixtureDatabase = created.database
  const databaseContract = (await import(
    './phase9-database-contract.mjs'
  )) as Phase9DatabaseContractModule
  const baseline = await databaseContract.capturePhase9DatabaseSnapshot(
    harness.adminDatabaseUrl
  )

  const [apiPort, webPort] = await Promise.all([
    reserveLoopbackPort(),
    reserveLoopbackPort()
  ])
  const apiOrigin = `http://127.0.0.1:${apiPort}`
  const webOrigin = `http://127.0.0.1:${webPort}`
  const apiEnvironment: NodeJS.ProcessEnv = {
    ...harness.sharedEnvironment,
    ADMIN_CMS_MODE: 'technical',
    AUTH_EMAIL_DELIVERY_MODE: 'test-sink',
    AUTH_EMAIL_FROM: 'auth@example.test',
    AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'),
    BETTER_AUTH_URL: apiOrigin,
    GUEST_COOKIE_SECRET: randomBytes(32).toString('base64url'),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
    PORT: String(apiPort),
    PRACTICE_CONTRACT_RUNTIME: 'v1-v2',
    TRUSTED_ORIGINS: webOrigin
  }
  delete apiEnvironment.PRACTICE_COMPATIBILITY_AUTHORITY_FILE
  const api = spawnOwned(
    'phase9-real-api',
    'pnpm',
    ['--filter', '@nihongo/api', 'exec', 'tsx', 'src/server.ts'],
    apiEnvironment
  )
  await waitForHttp(`${apiOrigin}/health/ready`, api)

  const web = spawnOwned(
    'phase9-real-web',
    'pnpm',
    [
      '--filter',
      '@nihongo/web',
      'exec',
      'vite',
      '--mode',
      'test',
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
      '--strictPort'
    ],
    {
      ...process.env,
      NIHONGO_API_PROXY_TARGET: apiOrigin,
      VITE_API_BASE_URL: '/api',
      VITE_API_MODE: 'real'
    }
  )
  await waitForHttp(webOrigin, web)

  await runPlaywright('real', webOrigin, {
    PHASE9_BROWSER_FIXTURE: JSON.stringify(created.fixture)
  })
  const databaseEvidence = await databaseContract.assertPhase9DatabaseContract({
    before: baseline,
    databaseUrl: harness.adminDatabaseUrl,
    fixture: created.fixture
  })
  const evidenceDirectory = nodePath.resolve(
    repositoryRoot,
    'test-results/playwright-phase9-real'
  )
  await mkdir(evidenceDirectory, { recursive: true })
  await writeFile(
    nodePath.resolve(evidenceDirectory, 'phase9-database-contract.json'),
    `${JSON.stringify(databaseEvidence, null, 2)}\n`,
    'utf8'
  )
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void cleanup()
      .then(() => process.exit(signal === 'SIGINT' ? 130 : 143))
      .catch(() => process.exit(1))
  })
}

const run = async (): Promise<void> => {
  if (!mode) {
    throw new Error('Phase 9 browser runner accepts mock or real mode.')
  }
  if (mode === 'mock') await runMock()
  else await runReal()
}

const execute = async (): Promise<void> => {
  let failure: unknown
  try {
    await run()
  } catch (error: unknown) {
    failure = error
  }

  try {
    await cleanup()
  } catch (cleanupError: unknown) {
    if (failure) {
      throw new AggregateError(
        [failure, cleanupError],
        `Phase 9 ${mode ?? 'unknown'} browser run and cleanup both failed.`
      )
    }
    throw cleanupError
  }

  if (failure) throw failure
}

const describeFailure = (
  error: unknown
): { readonly errorName: string; readonly message: string } => ({
  errorName: error instanceof Error ? error.name : 'UnknownError',
  message: error instanceof Error ? error.message : 'Unknown failure'
})

void execute()
  .then(() => {
    process.stdout.write(
      `${JSON.stringify({ event: `phase9.browser.${mode}.passed` })}\n`
    )
  })
  .catch((error: unknown) => {
    const causes =
      error instanceof AggregateError
        ? error.errors.map((cause) => describeFailure(cause))
        : undefined
    process.stderr.write(
      `${JSON.stringify({
        event: `phase9.browser.${mode ?? 'unknown'}.failed`,
        ...describeFailure(error),
        ...(causes ? { causes } : {})
      })}\n`
    )
    process.exitCode = 1
  })

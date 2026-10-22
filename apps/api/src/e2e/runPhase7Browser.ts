import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import nodePath from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type { Phase7BrowserFixtureDatabase } from './phase7BrowserFixture.js'
import {
  retireOwnedProcess,
  shouldDetachOwnedProcess,
  stopOwnedProcesses
} from './ownedProcessGroup.js'

const repositoryRoot = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
)

interface ManagedProcess {
  readonly child: ChildProcess
  readonly label: string
  spawnError: Error | undefined
}

type BrowserMode = 'mock' | 'real'

const isPhase8Acceptance = process.env.PHASE8_BROWSER_ACCEPTANCE === '1'
const acceptancePhase = isPhase8Acceptance ? 'phase8' : 'phase7'
const [rawMode, ...rawPlaywrightArguments] = process.argv.slice(2)
const mode: BrowserMode | undefined =
  rawMode === 'mock' || rawMode === 'real' ? rawMode : undefined
const playwrightArguments = rawPlaywrightArguments.filter(
  (argument, index) => !(index === 0 && argument === '--')
)
const ownedProcesses: ManagedProcess[] = []
let controlServer: Server | undefined
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
      const response = await fetch(url, { redirect: 'manual' })
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

const closeControlServer = async (): Promise<void> => {
  const server = controlServer
  controlServer = undefined
  if (!server) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

const cleanup = (): Promise<void> => {
  cleanupPromise ??= (async () => {
    let firstError: unknown
    const record = (error: unknown): void => {
      firstError ??= error
    }

    try {
      await stopOwnedProcesses(ownedProcesses, {
        onForceKill: ({ label }) => {
          process.stderr.write(
            `[${label}] graceful stop timed out; sending SIGKILL.\n`
          )
        }
      })
    } catch (error: unknown) {
      record(error)
    } finally {
      ownedProcesses.length = 0
    }

    try {
      await closeControlServer()
    } catch (error: unknown) {
      record(error)
    }

    if (fixtureDatabase) {
      try {
        await fixtureDatabase.disconnect()
      } catch (error: unknown) {
        record(error)
      }
      fixtureDatabase = undefined
    }

    if (cleanupDatabaseHarness) {
      try {
        await cleanupDatabaseHarness()
      } catch (error: unknown) {
        record(error)
      }
      cleanupDatabaseHarness = undefined
    }

    if (firstError) throw firstError
  })()
  return cleanupPromise
}

const startControlServer = async ({
  authorUserId,
  database,
  secret
}: {
  readonly authorUserId: string
  readonly database: Phase7BrowserFixtureDatabase
  readonly secret: string
}): Promise<string> => {
  const port = await reserveLoopbackPort()
  const server = createHttpServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
      if (
        request.method !== 'POST' ||
        url.pathname !== '/age-fresh-assurance' ||
        request.headers.authorization !== `Bearer ${secret}`
      ) {
        response.writeHead(404).end()
        return
      }

      let body = ''
      for await (const chunk of request) {
        body += String(chunk)
        if (body.length > 4_096) {
          response.writeHead(413).end()
          return
        }
      }
      const parsed = JSON.parse(body) as { userId?: unknown }
      if (parsed.userId !== authorUserId) {
        response.writeHead(400).end()
        return
      }
      await database.ageFreshAssurance(authorUserId)
      response.writeHead(204).end()
    })().catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'unknown control failure'
      process.stderr.write(`[phase7-browser-control] ${message}\n`)
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })
  controlServer = server
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return `http://127.0.0.1:${port}`
}

const runPlaywright = async (
  browserMode: BrowserMode,
  webOrigin: string,
  extraEnvironment: NodeJS.ProcessEnv = {}
): Promise<void> => {
  const browserSpecs = [
    'apps/web/e2e/phase7-admin-cms-mock.spec.ts',
    ...(isPhase8Acceptance
      ? ['apps/web/e2e/phase8-dashboard-real-mock.spec.ts']
      : [])
  ]
  await runCommand(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '--config',
      'playwright.config.ts',
      ...browserSpecs,
      ...playwrightArguments
    ],
    {
      ...process.env,
      ...extraEnvironment,
      PHASE7_BROWSER_MODE: browserMode,
      PHASE8_BROWSER_MODE: browserMode,
      PLAYWRIGHT_BASE_URL: webOrigin,
      PLAYWRIGHT_OUTPUT_LABEL: `${acceptancePhase}-${browserMode}`
    }
  )
}

const runMock = async (): Promise<void> => {
  await runCommand('pnpm', ['run', 'build:contracts'])
  await runCommand('pnpm', ['run', 'build:domain'])

  // The mock branch intentionally starts no API or database harness.
  const webPort = await reserveLoopbackPort()
  const webOrigin = `http://127.0.0.1:${webPort}`
  const web = spawnOwned(
    `${acceptancePhase}-mock-web`,
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
    await import('./runPhase7ApiIntegration.js')
  cleanupDatabaseHarness = cleanupPhase7IsolatedDatabase
  const harness = await preparePhase7IsolatedDatabase({ seedRuns: 2 })
  const { createPhase7BrowserFixture } = await import(
    './phase7BrowserFixture.js'
  )
  const created = await createPhase7BrowserFixture(harness.adminDatabaseUrl)
  fixtureDatabase = created.database
  const baseline = await created.database.snapshot()

  const [apiPort, webPort] = await Promise.all([
    reserveLoopbackPort(),
    reserveLoopbackPort()
  ])
  const apiOrigin = `http://127.0.0.1:${apiPort}`
  const webOrigin = `http://127.0.0.1:${webPort}`
  const controlSecret = randomBytes(32).toString('base64url')
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
    `${acceptancePhase}-real-api`,
    'pnpm',
    ['--filter', '@nihongo/api', 'exec', 'tsx', 'src/server.ts'],
    apiEnvironment
  )
  await waitForHttp(`${apiOrigin}/health/ready`, api)

  const web = spawnOwned(
    `${acceptancePhase}-real-web`,
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

  const controlOrigin = await startControlServer({
    authorUserId: created.fixture.author.userId,
    database: created.database,
    secret: controlSecret
  })

  await runPlaywright('real', webOrigin, {
    PHASE7_BROWSER_CONTROL_SECRET: controlSecret,
    PHASE7_BROWSER_CONTROL_URL: controlOrigin,
    PHASE7_BROWSER_FIXTURE: JSON.stringify(created.fixture),
    PHASE8_BROWSER_FIXTURE: JSON.stringify(created.fixture)
  })
  await created.database.assertExpectedLifecycleDelta(baseline)
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
    throw new Error(
      `${acceptancePhase} browser runner accepts mock or real mode.`
    )
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
        `${acceptancePhase} ${mode ?? 'unknown'} browser run and cleanup both failed.`
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
      `${JSON.stringify({ event: `${acceptancePhase}.browser.${mode}.passed` })}\n`
    )
  })
  .catch((error: unknown) => {
    const causes =
      error instanceof AggregateError
        ? error.errors.map((cause) => describeFailure(cause))
        : undefined
    process.stderr.write(
      `${JSON.stringify({
        event: `${acceptancePhase}.browser.${mode ?? 'unknown'}.failed`,
        ...describeFailure(error),
        ...(causes ? { causes } : {})
      })}\n`
    )
    process.exitCode = 1
  })

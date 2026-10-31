import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { installStaticWeb } from '../app/staticWeb.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import nodePath from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { stopServerGracefully } from '../lifecycle/gracefulShutdown.js'
import { cleanupPhase10BrowserResources } from './phase10BrowserCleanup.js'
import type { OwnedProcess } from './ownedProcessGroup.js'
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
let webAssetsDirectory: string | undefined
let adminAssetsDirectory: string | undefined
let controlServer: Server | undefined
let apiServer: Server | undefined
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
  ownedProcess?: ManagedProcess
): Promise<void> => {
  const deadline = Date.now() + 45_000
  let lastStatus: number | undefined

  while (Date.now() < deadline) {
    if (ownedProcess?.spawnError) throw ownedProcess.spawnError
    if (
      ownedProcess &&
      (ownedProcess.child.exitCode !== null ||
        ownedProcess.child.signalCode !== null)
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
    `${ownedProcess?.label ?? url} did not become ready${
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

export const closePhase7BrowserApi = async (
  server: Server | undefined
): Promise<void> => {
  if (!server) return
  try {
    // DB cleanup remains owned by the outer guard, after listener shutdown.
    await stopServerGracefully({
      server,
      disconnectDatabase: async () => undefined
    })
  } catch (error: unknown) {
    if (
      !(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ERR_SERVER_NOT_RUNNING'
      )
    )
      throw error
  }
}

export const cleanupPhase7BrowserResources = async (
  processes: OwnedProcess[],
  actions: Parameters<typeof cleanupPhase10BrowserResources>[0]
): Promise<void> => {
  await cleanupPhase10BrowserResources({
    ...actions,
    stopOwnedProcesses: async () => {
      await actions.stopOwnedProcesses()
      processes.length = 0
    }
  })
}

export const cleanup = (): Promise<void> => {
  cleanupPromise ??= cleanupPhase7BrowserResources(ownedProcesses, {
    stopOwnedProcesses: async () => {
      await stopOwnedProcesses(ownedProcesses, {
        onForceKill: ({ label }) => {
          process.stderr.write(
            `[${label}] graceful stop timed out; sending SIGKILL.\n`
          )
        }
      })
      await closePhase7BrowserApi(apiServer)
      apiServer = undefined
    },
    closeControlServer,
    cleanupDatabase: async () => {
      let firstError: unknown
      if (fixtureDatabase) {
        try {
          await fixtureDatabase.disconnect()
        } catch (error: unknown) {
          firstError = error
        }
        fixtureDatabase = undefined
      }
      if (cleanupDatabaseHarness) {
        try {
          await cleanupDatabaseHarness()
        } catch (error: unknown) {
          firstError ??= error
        }
        cleanupDatabaseHarness = undefined
      }
      if (webAssetsDirectory) {
        try {
          await rm(webAssetsDirectory, { recursive: true, force: true })
          webAssetsDirectory = undefined
        } catch (error: unknown) {
          firstError ??= error
        }
      }
      if (adminAssetsDirectory) {
        try {
          await rm(adminAssetsDirectory, { recursive: true, force: true })
          adminAssetsDirectory = undefined
        } catch (error: unknown) {
          firstError ??= error
        }
      }
      if (firstError) throw firstError
    }
  })
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

export const createPhase7BrowserPlaywrightEnvironment = (
  browserMode: BrowserMode,
  webOrigin: string,
  extraEnvironment: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv => ({
  ...process.env,
  ...extraEnvironment,
  PHASE7_BROWSER_MODE: browserMode,
  PHASE8_BROWSER_MODE: browserMode,
  PHASE7_BROWSER_ADMIN_ORIGIN: webOrigin,
  PLAYWRIGHT_BASE_URL: webOrigin,
  PLAYWRIGHT_OUTPUT_LABEL: `${acceptancePhase}-${browserMode}`
})

export const selectPhase7BrowserSpecs = (
  browserMode: BrowserMode,
  phase8: boolean
): string[] => {
  const specs = [
    ...(browserMode === 'real' ? ['apps/web/e2e/admin-cms.spec.ts'] : []),
    ...(phase8 ? ['apps/web/e2e/phase8-dashboard-real-mock.spec.ts'] : [])
  ]
  if (specs.length === 0)
    throw new Error(
      'Phase 7 administrator UI requires real mode; Mock coverage starts with the Phase 8 dashboard.'
    )
  return specs
}

const runPlaywright = async (
  browserMode: BrowserMode,
  webOrigin: string,
  extraEnvironment: NodeJS.ProcessEnv = {}
): Promise<void> => {
  const browserSpecs = selectPhase7BrowserSpecs(browserMode, isPhase8Acceptance)
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
    createPhase7BrowserPlaywrightEnvironment(
      browserMode,
      webOrigin,
      extraEnvironment
    )
  )
}

export const runMock = async (): Promise<void> => {
  // Reject an empty selection before starting resources or running all e2e files.
  selectPhase7BrowserSpecs('mock', isPhase8Acceptance)
  await runCommand('pnpm', ['--filter', '@nihongo/contracts', 'run', 'build'])
  await runCommand('pnpm', ['--filter', '@nihongo/domain', 'run', 'build'])

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
      NIHONGO_ADMIN_PROXY_TARGET: undefined,
      VITE_API_BASE_URL: '/api',
      VITE_API_MODE: 'mock'
    }
  )
  await waitForHttp(webOrigin, web)
  await runPlaywright('mock', webOrigin)
}

export const runReal = async (): Promise<void> => {
  const { cleanupPhase7IsolatedDatabase, preparePhase7IsolatedDatabase } =
    await import('./runPhase7ApiIntegration.js')
  cleanupDatabaseHarness = cleanupPhase7IsolatedDatabase
  const harness = await preparePhase7IsolatedDatabase({
    seedRuns: 2,
    artifactsPrepared: process.env.JLP541_BROWSER_ARTIFACTS_PREPARED === '1'
  })
  const apiPort = await reserveLoopbackPort()
  const publicOrigin = `http://127.0.0.1:${apiPort}`
  const releaseId = '0'.repeat(40)
  const controlSecret = randomBytes(32).toString('base64url')
  const apiEnvironment: NodeJS.ProcessEnv = {
    ...harness.sharedEnvironment,
    ADMIN_CMS_MODE: 'technical',
    AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'),
    BETTER_AUTH_URL: publicOrigin,
    GUEST_COOKIE_SECRET: randomBytes(32).toString('base64url'),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
    PORT: String(apiPort),
    PRACTICE_CONTRACT_RUNTIME: 'v1-v2',
    TRUSTED_ORIGINS: publicOrigin,
    RELEASE_ID: releaseId
  }
  delete apiEnvironment.PRACTICE_COMPATIBILITY_AUTHORITY_FILE
  for (const key of [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'APPLE_CLIENT_ID',
    'APPLE_CLIENT_SECRET'
  ])
    delete apiEnvironment[key]
  const [
    { createPhase7SsoAdminBrowserApiFixture },
    { parseApiEnvironment },
    { getRequestListener }
  ] = await Promise.all([
    import('./phase7BrowserFixture.js'),
    import('../config/env.js'),
    import('@hono/node-server')
  ])
  const created = await createPhase7SsoAdminBrowserApiFixture(
    {
      databaseUrl: harness.applicationDatabaseUrl,
      authGatewayDatabaseUrl: harness.authGatewayDatabaseUrl,
      adminDatabaseUrl: harness.adminDatabaseUrl,
      environment: parseApiEnvironment(apiEnvironment)
    },
    'admin-a1-a8'
  )
  fixtureDatabase = created.database
  if (!created.adminGuard)
    throw new Error(
      `${acceptancePhase} Real requires an administrator static guard.`
    )
  const baseline = await created.database.snapshot()
  webAssetsDirectory = await mkdtemp(
    nodePath.join(tmpdir(), `${acceptancePhase}-browser-web-`)
  )
  adminAssetsDirectory = await mkdtemp(
    nodePath.join(tmpdir(), `${acceptancePhase}-browser-admin-`)
  )
  for (const [application, directory] of [
    ['@nihongo/web', webAssetsDirectory],
    ['@nihongo/admin', adminAssetsDirectory]
  ] as const) {
    await runCommand(
      'pnpm',
      [
        '--filter',
        application,
        'exec',
        'vite',
        'build',
        '--outDir',
        directory,
        '--emptyOutDir'
      ],
      {
        ...process.env,
        NODE_ENV: 'production',
        VITE_API_MODE: 'real',
        VITE_API_BASE_URL: '/api',
        VITE_RELEASE_ID: releaseId
      }
    )
  }
  // Use production static serving for both apps on the API origin.
  installStaticWeb({
    app: created.app,
    releaseId,
    webAssetsDirectory,
    adminAssetsDirectory,
    adminGuard: created.adminGuard
  })
  await created.checkReadiness()
  const server = createHttpServer(getRequestListener(created.app.fetch))
  apiServer = server
  server.headersTimeout = 10_000
  server.requestTimeout = 15_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(apiPort, '127.0.0.1', resolve)
  })
  await waitForHttp(`${publicOrigin}/health/ready`)
  await waitForHttp(publicOrigin)
  const controlOrigin = await startControlServer({
    authorUserId: created.fixture.author.userId,
    database: created.database,
    secret: controlSecret
  })
  await runPlaywright('real', publicOrigin, {
    PHASE7_BROWSER_CONTROL_SECRET: controlSecret,
    PHASE7_BROWSER_CONTROL_URL: controlOrigin,
    PHASE7_BROWSER_FIXTURE: JSON.stringify(created.fixture),
    PHASE8_BROWSER_FIXTURE: JSON.stringify(created.fixture)
  })
  await created.database.assertExpectedLifecycleDelta(baseline)
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

export const execute = async (): Promise<void> => {
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

if (
  process.argv[1] &&
  nodePath.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void cleanup()
        .then(() => process.exit(signal === 'SIGINT' ? 130 : 143))
        .catch(() => process.exit(1))
    })
  }

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
}

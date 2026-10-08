import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server
} from 'node:http'
import { createServer as createNetServer } from 'node:net'
import nodePath from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type { Phase7BrowserFixtureDatabase } from '../apps/api/src/e2e/phase7BrowserFixture.js'
import { cleanupPhase10BrowserResources } from '../apps/api/src/e2e/phase10BrowserCleanup.js'
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

interface RegistrationCredentials {
  readonly email: string
  readonly name: string
  readonly password: string
  readonly targetLevel: 'N4'
}

interface AuthEmailMessageCandidate {
  readonly purpose?: unknown
  readonly recipient?: unknown
  readonly url?: unknown
}

type BrowserMode = 'mock' | 'real'

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

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  let body = ''
  for await (const chunk of request) {
    body += String(chunk)
    if (body.length > 65_536) {
      throw new Error('Phase 10 email control payload is too large.')
    }
  }
  return JSON.parse(body) as unknown
}

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

const startEmailControlServer = async ({
  expectedRecipient,
  secret,
  webOrigin
}: {
  readonly expectedRecipient: string
  readonly secret: string
  readonly webOrigin: string
}): Promise<string> => {
  const port = await reserveLoopbackPort()
  let verificationUrl: string | undefined
  const server = createHttpServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
      const bearerAuthorized =
        request.headers.authorization === `Bearer ${secret}`
      const cookieAuthorized = request.headers.cookie
        ?.split(';')
        .some((cookie) => cookie.trim() === `phase10_control=${secret}`)
      if (!bearerAuthorized && !cookieAuthorized) {
        response.writeHead(404).end()
        return
      }

      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/auth-email' &&
        bearerAuthorized
      ) {
        const payload = (await readJsonBody(
          request
        )) as AuthEmailMessageCandidate
        if (
          payload.purpose !== 'EMAIL_VERIFICATION' ||
          payload.recipient !== expectedRecipient ||
          typeof payload.url !== 'string'
        ) {
          response.writeHead(400).end()
          return
        }
        const candidate = new URL(payload.url)
        if (
          candidate.origin !== webOrigin ||
          candidate.pathname !== '/verify-email' ||
          !candidate.hash.startsWith('#token=')
        ) {
          response.writeHead(400).end()
          return
        }
        verificationUrl = candidate.href
        response.writeHead(204, { 'Cache-Control': 'no-store' }).end()
        return
      }

      if (
        request.method === 'GET' &&
        requestUrl.pathname === '/verification-ready' &&
        bearerAuthorized
      ) {
        if (!verificationUrl) {
          response.writeHead(404, { 'Cache-Control': 'no-store' }).end()
          return
        }
        response.writeHead(204, { 'Cache-Control': 'no-store' }).end()
        return
      }

      if (
        request.method === 'GET' &&
        requestUrl.pathname === '/verification-navigation' &&
        cookieAuthorized &&
        verificationUrl
      ) {
        const location = verificationUrl
        verificationUrl = undefined
        response
          .writeHead(302, {
            'Cache-Control': 'no-store',
            Location: location,
            'Set-Cookie':
              'phase10_control=; Max-Age=0; Path=/verification-navigation; HttpOnly; SameSite=Strict'
          })
          .end()
        return
      }

      response.writeHead(404).end()
    })().catch(() => {
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

const cleanup = (): Promise<void> => {
  cleanupPromise ??= cleanupPhase10BrowserResources({
    stopOwnedProcesses: async () => {
      await stopOwnedProcesses(ownedProcesses, {
        onForceKill: ({ label }) => {
          process.stderr.write(
            `[${label}] graceful stop timed out; sending SIGKILL.\n`
          )
        }
      })
      ownedProcesses.length = 0
    },
    closeControlServer,
    cleanupDatabase: async () => {
      const errors: unknown[] = []
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

      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) {
        throw new AggregateError(errors, 'Phase 10 database cleanup failed.')
      }
    }
  })
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
      'apps/web/e2e/phase10-journeys-real-mock.spec.ts',
      ...playwrightArguments
    ],
    {
      ...process.env,
      ...extraEnvironment,
      PHASE10_BROWSER_MODE: browserMode,
      PLAYWRIGHT_BASE_URL: webOrigin,
      PLAYWRIGHT_OUTPUT_LABEL: `phase10-${browserMode}`
    }
  )
}

const runMock = async (): Promise<void> => {
  await runCommand('pnpm', ['run', 'build:contracts'])
  await runCommand('pnpm', ['run', 'build:domain'])

  const webPort = await reserveLoopbackPort()
  const webOrigin = `http://127.0.0.1:${webPort}`
  const web = spawnOwned(
    'phase10-mock-web',
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

  const registration: RegistrationCredentials = {
    email: `phase10-browser-${randomUUID()}@example.test`,
    name: 'Phase 10 가입 학습자',
    password: `Phase10-${randomBytes(18).toString('base64url')}!Aa9`,
    targetLevel: 'N4'
  }
  const [apiPort, webPort] = await Promise.all([
    reserveLoopbackPort(),
    reserveLoopbackPort()
  ])
  const apiOrigin = `http://127.0.0.1:${apiPort}`
  const webOrigin = `http://127.0.0.1:${webPort}`
  const controlSecret = randomBytes(32).toString('base64url')
  const controlOrigin = await startEmailControlServer({
    expectedRecipient: registration.email,
    secret: controlSecret,
    webOrigin
  })
  const apiEnvironment: NodeJS.ProcessEnv = {
    ...harness.sharedEnvironment,
    ADMIN_CMS_MODE: 'technical',
    AUTH_EMAIL_DELIVERY_MODE: 'webhook',
    AUTH_EMAIL_FROM: 'auth@example.test',
    AUTH_EMAIL_WEBHOOK_SECRET: controlSecret,
    AUTH_EMAIL_WEBHOOK_URL: `${controlOrigin}/auth-email`,
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
    'phase10-real-api',
    'pnpm',
    ['--filter', '@nihongo/api', 'exec', 'tsx', 'src/server.ts'],
    apiEnvironment
  )
  await waitForHttp(`${apiOrigin}/health/ready`, api)

  const web = spawnOwned(
    'phase10-real-web',
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
    PHASE10_BROWSER_CONTROL_SECRET: controlSecret,
    PHASE10_BROWSER_CONTROL_URL: controlOrigin,
    PHASE10_BROWSER_FIXTURE: JSON.stringify(created.fixture),
    PHASE10_REGISTRATION_FIXTURE: JSON.stringify(registration)
  })
  await created.database.assertRegisteredUser(registration)
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
    throw new Error('Phase 10 browser runner accepts mock or real mode.')
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
        `Phase 10 ${mode ?? 'unknown'} browser run and cleanup both failed.`
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
      `${JSON.stringify({ event: `phase10.browser.${mode}.passed` })}\n`
    )
  })
  .catch((error: unknown) => {
    const causes =
      error instanceof AggregateError
        ? error.errors.map((cause) => describeFailure(cause))
        : undefined
    process.stderr.write(
      `${JSON.stringify({
        event: `phase10.browser.${mode ?? 'unknown'}.failed`,
        ...describeFailure(error),
        ...(causes ? { causes } : {})
      })}\n`
    )
    process.exitCode = 1
  })

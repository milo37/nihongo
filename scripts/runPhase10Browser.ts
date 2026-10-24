import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createServer as createNetServer } from 'node:net'
import nodePath from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
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
  completion?: {
    readonly code: number | null
    readonly signal: NodeJS.Signals | null
  }
}

type BrowserMode = 'mock' | 'real'

const [rawMode, ...rawPlaywrightArguments] = process.argv.slice(2)
const mode: BrowserMode | undefined =
  rawMode === 'mock' || rawMode === 'real' ? rawMode : undefined
const playwrightArguments = rawPlaywrightArguments.filter(
  (argument, index) => !(index === 0 && argument === '--')
)
const ownedProcesses: ManagedProcess[] = []
let cleanupPromise: Promise<void> | undefined

const formatCommand = (command: string, args: readonly string[]): string =>
  [command, ...args].join(' ')

const spawnOwned = (
  label: string,
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  cwd = repositoryRoot
): ManagedProcess => {
  const child = spawn(command, args, {
    cwd,
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
  child.once('close', (code, signal) => {
    ownedProcess.completion = { code, signal }
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
  cleanupPromise ??= cleanupPhase10BrowserResources({
    stopOwnedProcesses: async () => {
      const api = ownedProcesses.find(
        ({ label }) => label === 'phase10-real-sso-api'
      )
      const exitedEarly =
        api !== undefined &&
        (api.completion !== undefined ||
          api.child.exitCode !== null ||
          api.child.signalCode !== null)
      let apiForced = false
      await stopOwnedProcesses(ownedProcesses, {
        onForceKill: (owned) => {
          const { label } = owned
          if (owned === api) apiForced = true
          process.stderr.write(
            `[${label}] graceful stop timed out; sending SIGKILL.\n`
          )
        }
      })
      if (api) {
        if (api.spawnError) throw api.spawnError
        if (exitedEarly || apiForced) {
          throw new Error(
            'Real SSO child exited early or required a forced stop.'
          )
        }
        if (!api.completion) {
          await once(api.child, 'close', { signal: AbortSignal.timeout(2_000) })
        }
        if (
          !api.completion ||
          api.completion.code !== 0 ||
          api.completion.signal !== null
        ) {
          throw new Error(
            'Real SSO child did not complete TEST fixture cleanup successfully.'
          )
        }
      }
      ownedProcesses.length = 0
    },
    closeControlServer: async () => {
      // The existing SSO child owns its listener.
    },
    cleanupDatabase: async () => {
      // The existing SSO child owns TEST fixture and harness cleanup.
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
  const webPort = await reserveLoopbackPort()
  const apiPort = await reserveLoopbackPort()
  const webOrigin = `http://127.0.0.1:${webPort}`
  const apiOrigin = `http://127.0.0.1:${apiPort}`
  const api = spawnOwned(
    'phase10-real-sso-api',
    process.execPath,
    [
      '--import',
      createRequire(
        new URL('../apps/api/package.json', import.meta.url)
      ).resolve('tsx'),
      'src/e2e/runPhase7ApiIntegration.ts'
    ],
    {
      ...process.env,
      PHASE7_API_INTEGRATION_CASE: 'sso-browser-google',
      PHASE7_SSO_BROWSER_API_HOST: '127.0.0.1',
      PHASE7_SSO_BROWSER_API_PORT: String(apiPort),
      PHASE7_SSO_BROWSER_WEB_ORIGIN: webOrigin
    },
    nodePath.join(repositoryRoot, 'apps/api')
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
  await runPlaywright('real', webOrigin)
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

export const main = (): Promise<void> =>
  execute()
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

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === nodePath.resolve(process.argv[1])
) {
  void main()
}

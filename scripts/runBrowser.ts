import { prepareBrowserArtifacts } from '../apps/api/src/e2e/browserArtifactPreparation.ts'
import { createRequire } from 'node:module'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'

export type BrowserMode = 'real' | 'mock'
export type BrowserSuite = 'admin' | 'accessibility' | 'journey' | 'mock-states'

export interface BrowserSuiteResources {
  run: (signal: AbortSignal) => Promise<void>
  cleanup: () => Promise<void>
}

export interface BrowserSuiteDriver {
  prepare: (mode: BrowserMode, signal: AbortSignal) => Promise<void>
  // Resource acquisition belongs in run so cleanup can handle partial startup.
  openSuite: (
    suite: BrowserSuite,
    signal: AbortSignal
  ) => Promise<BrowserSuiteResources>
}

export const runBrowserSuites = async (
  mode: BrowserMode,
  driver: BrowserSuiteDriver,
  signal: AbortSignal
): Promise<void> => {
  if (mode !== 'real' && mode !== 'mock') {
    throw new Error('Browser runner accepts real or mock mode.')
  }
  signal.throwIfAborted()
  await driver.prepare(mode, signal)
  const suites: readonly BrowserSuite[] =
    mode === 'real' ? ['admin', 'accessibility', 'journey'] : ['mock-states']
  for (const suite of suites) {
    signal.throwIfAborted()
    const resources = await driver.openSuite(suite, signal)
    let failure: unknown
    let failed = false
    try {
      signal.throwIfAborted()
      await resources.run(signal)
      signal.throwIfAborted()
    } catch (error: unknown) {
      failed = true
      failure = error
    }
    try {
      await resources.cleanup()
    } catch (cleanupError: unknown) {
      if (failed) {
        throw new AggregateError(
          [failure, cleanupError],
          `Browser suite ${suite} and cleanup both failed.`
        )
      }
      throw cleanupError
    }
    if (failed) throw failure
  }
}

const realWorkerModules = {
  admin: '../apps/api/src/e2e/runPhase7Browser.js',
  accessibility: './runPhase9Browser.js',
  journey: './runPhase10Browser.js'
} as const

type RealSuite = keyof typeof realWorkerModules

const isRealSuite = (value: string): value is RealSuite =>
  Object.hasOwn(realWorkerModules, value)

type BrowserAdapter = Pick<
  typeof import('./runPhase9Browser.js'),
  'runCommand' | 'runMockBrowser' | 'cleanup'
>

interface BrowserRunnerDependencies {
  readonly loadBrowserAdapter: () => Promise<BrowserAdapter>
  readonly resolveTsx: () => string
}

export const runBrowserMode = async (
  mode: BrowserMode,
  signal: AbortSignal,
  playwrightArguments: readonly string[] = [],
  dependencies: BrowserRunnerDependencies = {
    loadBrowserAdapter: async () => await import('./runPhase9Browser.js'),
    resolveTsx: () =>
      createRequire(
        new URL('../apps/api/package.json', import.meta.url)
      ).resolve('tsx')
  }
): Promise<void> => {
  const browserAdapter = await dependencies.loadBrowserAdapter()
  const previousPrepared = process.env.JLP541_BROWSER_ARTIFACTS_PREPARED
  delete process.env.JLP541_BROWSER_ARTIFACTS_PREPARED
  try {
    await runBrowserSuites(
      mode,
      {
        prepare: async (currentMode, currentSignal) => {
          await prepareBrowserArtifacts(
            currentMode,
            currentSignal,
            browserAdapter.runCommand
          )
          process.env.JLP541_BROWSER_ARTIFACTS_PREPARED = '1'
        },
        openSuite: async (suite) => {
          if (suite === 'mock-states') {
            return {
              run: browserAdapter.runMockBrowser,
              cleanup: browserAdapter.cleanup
            }
          }
          const tsx = dependencies.resolveTsx()
          return {
            run: async (currentSignal) => {
              await browserAdapter.runCommand(
                process.execPath,
                [
                  '--import',
                  tsx,
                  fileURLToPath(import.meta.url),
                  'real',
                  '--suite',
                  suite,
                  ...playwrightArguments
                ],
                { ...process.env, PHASE8_BROWSER_ACCEPTANCE: '1' },
                currentSignal
              )
            },
            cleanup: async () => undefined
          }
        }
      },
      signal
    )
  } finally {
    if (previousPrepared === undefined) {
      delete process.env.JLP541_BROWSER_ARTIFACTS_PREPARED
    } else {
      process.env.JLP541_BROWSER_ARTIFACTS_PREPARED = previousPrepared
    }
  }
}

const runWorker = async (
  suite: RealSuite,
  playwrightArguments: readonly string[]
): Promise<void> => {
  process.argv = [
    process.argv[0],
    process.argv[1],
    'real',
    ...playwrightArguments
  ]
  const worker = await import(realWorkerModules[suite])
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void worker
        .cleanup()
        .then(() => process.exit(signal === 'SIGINT' ? 130 : 143))
        .catch(() => process.exit(1))
    })
  }
  await worker.execute()
}

const main = async (): Promise<void> => {
  const [mode, flag, suite, ...rest] = process.argv.slice(2)
  if (flag === '--suite') {
    if (mode !== 'real' || !suite || !isRealSuite(suite)) {
      throw new Error('Invalid browser worker suite.')
    }
    await runWorker(suite, rest)
    return
  }
  if (mode !== 'real' && mode !== 'mock') {
    throw new Error('Browser runner accepts real or mock mode.')
  }
  const controller = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      process.exitCode = signal === 'SIGINT' ? 130 : 143
      controller.abort(new Error(`Browser run interrupted: ${signal}`))
    })
  }
  const extraArguments = process.argv.slice(3)
  await runBrowserMode(
    mode,
    controller.signal,
    extraArguments[0] === '--' ? extraArguments.slice(1) : extraArguments
  )
}

if (
  process.argv[1] &&
  nodePath.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `Browser run failed: ${error instanceof Error ? error.message : 'unknown failure'}\n`
    )
    if (process.exitCode !== 130 && process.exitCode !== 143)
      process.exitCode = 1
  })
}

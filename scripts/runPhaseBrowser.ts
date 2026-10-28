import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
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

type Phase9Adapter = Pick<
  typeof import('./runPhase9Browser.js'),
  'runCommand' | 'runMockBrowser' | 'cleanup'
>

interface BrowserRunnerDependencies {
  readonly loadPhase9: () => Promise<Phase9Adapter>
  readonly resolveTsx: () => string
}

const browserPreparationInputs = [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  'package.json',
  'packages/contracts/package.json',
  'packages/contracts/tsconfig.json',
  'packages/contracts/tsconfig.build.json',
  'packages/contracts/src',
  'packages/domain/package.json',
  'packages/domain/tsconfig.json',
  'packages/domain/tsconfig.build.json',
  'packages/domain/src',
  'apps/api/package.json',
  'apps/api/prisma.config.ts',
  'apps/api/prisma/schema.prisma'
] as const
const browserPreparationOutputs = [
  'packages/contracts/dist',
  'packages/domain/dist',
  'apps/api/src/generated/prisma'
] as const

const hashPreparationPaths = (
  root: string,
  paths: readonly string[]
): string => {
  const hash = createHash('sha256')
  const visit = (relative: string): void => {
    const absolute = nodePath.join(root, relative)
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) throw new Error('Preparation path is a symlink')
    hash.update(JSON.stringify([relative, stat.isDirectory() ? 'dir' : 'file']))
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        visit(nodePath.join(relative, name))
      }
    } else if (stat.isFile()) {
      hash.update(readFileSync(absolute))
    } else throw new Error('Unsupported preparation path')
  }
  for (const path of paths) visit(path)
  return hash.digest('hex')
}

export const prepareBrowserArtifacts = async (
  mode: BrowserMode,
  signal: AbortSignal,
  runCommand: Phase9Adapter['runCommand'],
  root: string = fileURLToPath(new URL('..', import.meta.url)),
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> => {
  signal.throwIfAborted()
  const {
    CI,
    GITHUB_RUN_ID,
    GITHUB_RUN_ATTEMPT,
    GITHUB_JOB,
    GITHUB_SHA,
    RUNNER_TEMP
  } = environment
  const job =
    CI === 'true' &&
    GITHUB_RUN_ID &&
    GITHUB_RUN_ATTEMPT &&
    GITHUB_JOB &&
    GITHUB_SHA &&
    RUNNER_TEMP &&
    nodePath.isAbsolute(RUNNER_TEMP)
      ? [
          GITHUB_RUN_ID,
          GITHUB_RUN_ATTEMPT,
          GITHUB_JOB,
          GITHUB_SHA,
          nodePath.resolve(root),
          process.version,
          process.platform,
          process.arch
        ]
      : undefined
  const manifestPath =
    job &&
    nodePath.join(
      RUNNER_TEMP as string,
      `jlp541-browser-${createHash('sha256').update(JSON.stringify(job)).digest('hex')}.json`
    )
  let input: string | undefined
  if (manifestPath) {
    try {
      input = hashPreparationPaths(root, browserPreparationInputs)
      const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const output = hashPreparationPaths(root, browserPreparationOutputs)
      if (JSON.stringify(manifest) === JSON.stringify({ job, input, output }))
        return
    } catch {
      // Missing or changed inputs/outputs must rebuild rather than reuse.
    }
  }
  for (const args of [
    ['--filter', '@nihongo/contracts', 'run', 'build'],
    ['--filter', '@nihongo/domain', 'run', 'build'],
    ...(mode === 'real'
      ? [['--filter', '@nihongo/api', 'run', 'db:generate']]
      : [])
  ]) {
    signal.throwIfAborted()
    await runCommand('pnpm', args, environment, signal)
    signal.throwIfAborted()
  }
  if (manifestPath && mode === 'real' && input) {
    const output = hashPreparationPaths(root, browserPreparationOutputs)
    if (input !== hashPreparationPaths(root, browserPreparationInputs)) {
      throw new Error('Browser preparation inputs changed during build')
    }
    mkdirSync(nodePath.dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, JSON.stringify({ job, input, output }), {
      mode: 0o600
    })
  }
}

export const runBrowserMode = async (
  mode: BrowserMode,
  signal: AbortSignal,
  playwrightArguments: readonly string[] = [],
  dependencies: BrowserRunnerDependencies = {
    loadPhase9: async () => await import('./runPhase9Browser.js'),
    resolveTsx: () =>
      createRequire(
        new URL('../apps/api/package.json', import.meta.url)
      ).resolve('tsx')
  }
): Promise<void> => {
  const phase9 = await dependencies.loadPhase9()
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
            phase9.runCommand
          )
          process.env.JLP541_BROWSER_ARTIFACTS_PREPARED = '1'
        },
        openSuite: async (suite) => {
          if (suite === 'mock-states') {
            return { run: phase9.runMockBrowser, cleanup: phase9.cleanup }
          }
          const tsx = dependencies.resolveTsx()
          return {
            run: async (currentSignal) => {
              await phase9.runCommand(
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

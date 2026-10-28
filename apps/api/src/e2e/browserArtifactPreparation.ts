import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'

type BrowserMode = 'real' | 'mock'

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
  runCommand: (
    command: string,
    args: readonly string[],
    environment: NodeJS.ProcessEnv,
    signal?: AbortSignal
  ) => Promise<void>,
  root: string = fileURLToPath(new URL('../../../../', import.meta.url)),
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

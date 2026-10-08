import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { phase10ApiIntegrationManifest } from './phase10ApiIntegrationManifest.js'

interface VitestJsonResult {
  readonly numFailedTests?: number
  readonly numPassedTests?: number
  readonly numPendingTests?: number
  readonly numTodoTests?: number
  readonly numTotalTests?: number
  readonly testResults?: ReadonlyArray<{
    readonly failureMessage?: string
    readonly message?: string
    readonly name?: string
    readonly status?: string
    readonly assertionResults?: ReadonlyArray<{
      readonly fullName?: string
      readonly failureMessages?: readonly string[]
      readonly status?: string
    }>
  }>
}

type RunCommand = (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv
) => Promise<unknown>

const normalizeResultPath = (value: string): string => {
  const normalized = value.replaceAll(path.sep, '/')
  const marker = '/apps/api/'
  const markerIndex = normalized.lastIndexOf(marker)
  if (markerIndex !== -1) return normalized.slice(markerIndex + marker.length)
  return normalized.startsWith('src/') ? normalized : path.basename(normalized)
}

export const assertPhase10RequiredEnvironment = ({
  environment,
  testFile
}: {
  readonly environment: NodeJS.ProcessEnv
  readonly testFile: string
}): void => {
  const entry = phase10ApiIntegrationManifest.find(
    ({ path: manifestPath }) => manifestPath === testFile
  )
  if (!entry) {
    throw new Error(
      `Phase 10 integration manifest entry is missing: ${testFile}.`
    )
  }
  const missingNames = entry.requiredEnvironment.filter(
    (name) => !environment[name]?.trim()
  )
  if (missingNames.length > 0) {
    throw new Error(
      `Phase 10 integration environment is incomplete: ${testFile}; ` +
        `missing=${missingNames.join(',')}.`
    )
  }
}

export const assertPhase10VitestFileResult = ({
  result,
  expectedPath
}: {
  readonly result: VitestJsonResult
  readonly expectedPath: string
}): void => {
  if (
    result.numFailedTests !== 0 ||
    result.numPendingTests !== 0 ||
    (result.numTodoTests ?? 0) !== 0 ||
    !Number.isSafeInteger(result.numTotalTests) ||
    (result.numTotalTests ?? 0) < 1 ||
    result.numPassedTests !== result.numTotalTests
  ) {
    throw new Error(
      `Phase 10 integration result is incomplete: ${expectedPath}.`
    )
  }
  const resultPaths = (result.testResults ?? [])
    .map(({ name }) => (name ? normalizeResultPath(name) : ''))
    .filter(Boolean)
    .toSorted()
  if (JSON.stringify(resultPaths) !== JSON.stringify([expectedPath])) {
    throw new Error(
      `Phase 10 integration result path mismatch: ${expectedPath}.`
    )
  }
}

export const runPhase10ManifestVitestFile = async ({
  runCommand,
  testFile,
  environment
}: {
  readonly runCommand: RunCommand
  readonly testFile: string
  readonly environment: NodeJS.ProcessEnv
}): Promise<number> => {
  assertPhase10RequiredEnvironment({ environment, testFile })
  const outputFile = path.join(
    os.tmpdir(),
    `nihongo-phase10-vitest-${randomUUID()}.json`
  )
  try {
    try {
      await runCommand(
        'pnpm',
        [
          '--filter',
          '@nihongo/api',
          'exec',
          'vitest',
          'run',
          '--config',
          'vitest.integration.config.ts',
          testFile,
          '--reporter=json',
          `--outputFile=${outputFile}`
        ],
        environment
      )
    } catch {
      let result: VitestJsonResult | undefined
      try {
        result = JSON.parse(
          await readFile(outputFile, 'utf8')
        ) as VitestJsonResult
      } catch {
        throw new Error(`Phase 10 integration process failed: ${testFile}.`)
      }
      const failedTests = (result.testResults ?? []).flatMap(
        ({ assertionResults = [] }) =>
          assertionResults
            .filter(({ status }) => status === 'failed')
            .map(({ fullName }) => fullName ?? 'unnamed test')
      )
      throw new Error(
        `Phase 10 integration process failed: ${testFile}; ` +
          `failed=${result.numFailedTests ?? 'unknown'}; ` +
          `tests=${failedTests.join(' | ') || 'unavailable'}.`
      )
    }
    const result = JSON.parse(
      await readFile(outputFile, 'utf8')
    ) as VitestJsonResult
    assertPhase10VitestFileResult({ result, expectedPath: testFile })
    return result.numTotalTests ?? 0
  } finally {
    await rm(outputFile, { force: true })
  }
}

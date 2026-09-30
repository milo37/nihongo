import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { phase10ApiIntegrationManifest } from './phase10ApiIntegrationManifest.js'

const apiRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
)

const discoverIntegrationTests = async (
  directory: string
): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const discovered: string[] = []
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      discovered.push(...(await discoverIntegrationTests(absolutePath)))
    } else if (entry.isFile() && entry.name.endsWith('.integration.test.ts')) {
      discovered.push(
        path.relative(apiRoot, absolutePath).replaceAll(path.sep, '/')
      )
    }
  }
  return discovered.toSorted()
}

export const validatePhase10ApiIntegrationManifest = async (): Promise<{
  readonly discoveredCount: number
  readonly manifestCount: number
}> => {
  const discovered = await discoverIntegrationTests(path.join(apiRoot, 'src'))
  const manifestPaths = phase10ApiIntegrationManifest
    .map(({ path: testPath }) => testPath)
    .toSorted()
  if (new Set(manifestPaths).size !== manifestPaths.length) {
    throw new Error('Phase 10 integration manifest contains duplicate paths.')
  }
  if (JSON.stringify(discovered) !== JSON.stringify(manifestPaths)) {
    throw new Error(
      `Phase 10 integration manifest mismatch: discovered=${discovered.length}, manifest=${manifestPaths.length}.`
    )
  }

  for (const entry of phase10ApiIntegrationManifest) {
    if (
      entry.shard.length === 0 ||
      entry.databaseState.length === 0 ||
      entry.isolation.length === 0 ||
      !Number.isSafeInteger(entry.order) ||
      entry.order < 1
    ) {
      throw new Error(
        `Phase 10 integration manifest metadata is incomplete: ${entry.path}.`
      )
    }
    const source = await readFile(path.join(apiRoot, entry.path), 'utf8')
    if (
      /\.(?:skip|only|todo)\s*\(/u.test(source) ||
      /\b(?:skipIf|runIf)\s*\(/u.test(source) ||
      /\bRUN_[A-Z0-9_]+\b/u.test(source)
    ) {
      throw new Error(
        `Phase 10 integration manifest forbids skipped or environment-gated tests: ${entry.path}.`
      )
    }
  }

  for (const owner of ['phase7-api', 'phase7-db', 'phase10'] as const) {
    const entries = phase10ApiIntegrationManifest.filter(
      (entry) => entry.executionOwner === owner
    )
    const orderKeys = entries.map((entry) => entry.order)
    if (new Set(orderKeys).size !== orderKeys.length) {
      throw new Error(
        `Phase 10 integration owner ${owner} has duplicate order values.`
      )
    }
  }

  const phase7ApiRunnerContract = phase10ApiIntegrationManifest
    .filter(({ executionOwner }) => executionOwner === 'phase7-api')
    .toSorted((left, right) => left.order - right.order)
    .map(({ path: testPath, seedPolicy, shard }) => ({
      path: testPath,
      seedPolicy,
      shard
    }))
  if (
    JSON.stringify(phase7ApiRunnerContract) !==
    JSON.stringify([
      {
        path: 'src/app/phase7ApiGate.integration.test.ts',
        seedPolicy: 'none',
        shard: 'phase7-api-pre-seed'
      },
      {
        path: 'src/admin/adminQuestionRepository.integration.test.ts',
        seedPolicy: 'none',
        shard: 'phase7-api-pre-seed'
      },
      {
        path: 'src/admin/adminQuestionCommandRepository.integration.test.ts',
        seedPolicy: 'canonical-once',
        shard: 'phase7-api-post-seed'
      }
    ])
  ) {
    throw new Error(
      'Phase 7 API runner manifest contract changed unexpectedly.'
    )
  }

  return {
    discoveredCount: discovered.length,
    manifestCount: manifestPaths.length
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isDirectExecution) {
  validatePhase10ApiIntegrationManifest()
    .then((result) => {
      process.stdout.write(
        `${JSON.stringify({
          event: 'phase10.api_integration_manifest.passed',
          ...result
        })}\n`
      )
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({
          event: 'phase10.api_integration_manifest.failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : 'Unknown failure'
        })}\n`
      )
      process.exitCode = 1
    })
}

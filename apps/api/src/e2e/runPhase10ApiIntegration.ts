import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cleanupPhase7IsolatedDatabase,
  preparePhase7IsolatedDatabase
} from './runPhase7ApiIntegration.js'
import {
  retireOwnedProcess,
  shouldDetachOwnedProcess,
  stopOwnedProcesses
} from './ownedProcessGroup.js'
import { runPhase10ManifestVitestFile } from './phase10ApiIntegrationExecution.js'
import {
  getPhase10ApiIntegrationEntriesByOwner,
  type Phase10ApiIntegrationManifestEntry
} from './phase10ApiIntegrationManifest.js'
import { validatePhase10ApiIntegrationManifest } from './validatePhase10ApiIntegrationManifest.js'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
)
const commandProcesses: Array<{ child: ChildProcess; label: string }> = []
let cleanupPromise: Promise<void> | undefined
let harnessPrepared = false
const PG_CONCURRENT_QUERY_DEPRECATION =
  'Calling client.query() when the client is already executing a query is deprecated'

const formatCommand = (command: string, args: readonly string[]): string =>
  [command, ...args].join(' ')

const runCommand = async (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    let spawnError: Error | undefined
    let stderrOutput = ''
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      detached: shouldDetachOwnedProcess,
      env: environment,
      stdio: ['inherit', 'inherit', 'pipe']
    })
    const ownedCommand = { child, label: formatCommand(command, args) }
    commandProcesses.push(ownedCommand)
    child.once('error', (error) => {
      spawnError = error
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const output = chunk.toString()
      stderrOutput += output
      process.stderr.write(output)
    })
    child.once('close', (code, signal) => {
      void retireOwnedProcess(commandProcesses, ownedCommand).then(
        () => {
          if (spawnError) {
            reject(spawnError)
          } else if (
            code === 0 &&
            stderrOutput.includes(PG_CONCURRENT_QUERY_DEPRECATION)
          ) {
            reject(
              new Error(
                'Phase 10 integration emitted the forbidden pg concurrent-query deprecation.'
              )
            )
          } else if (code === 0) {
            resolve()
          } else {
            reject(
              new Error(
                `${ownedCommand.label} failed (` +
                  `${signal ?? `exit ${code ?? 'unknown'}`}).`
              )
            )
          }
        },
        (error: unknown) => reject(error)
      )
    })
  })

interface Phase10ShardResult {
  readonly databaseState: string
  readonly executedFileCount: number
  readonly isolation: string
  readonly passedTestCount: number
  readonly schemaName: string | null
  readonly schemaRemoved: boolean
  readonly seedRuns: number
  readonly shard: string
}

const readShardResult = (output: string): Phase10ShardResult => {
  const candidates = output
    .split('\n')
    .flatMap((line): unknown[] => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
    .filter(
      (value): value is Phase10ShardResult & { readonly event: string } =>
        typeof value === 'object' &&
        value !== null &&
        'event' in value &&
        value.event === 'phase10.api_integration.shard.passed'
    )
  const [result] = candidates
  if (!result || candidates.length !== 1) {
    throw new Error(
      'Phase 10 integration shard result is missing or ambiguous.'
    )
  }
  return result
}

const runShardProcess = async (shard: string): Promise<Phase10ShardResult> =>
  new Promise<Phase10ShardResult>((resolve, reject) => {
    const args = [
      '--filter',
      '@nihongo/api',
      'exec',
      'tsx',
      'src/e2e/runPhase10ApiIntegration.ts',
      `--shard=${shard}`
    ]
    let spawnError: Error | undefined
    let stdoutOutput = ''
    let stderrOutput = ''
    const child = spawn('pnpm', args, {
      cwd: repositoryRoot,
      detached: shouldDetachOwnedProcess,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe']
    })
    const ownedCommand = { child, label: formatCommand('pnpm', args) }
    commandProcesses.push(ownedCommand)
    child.once('error', (error) => {
      spawnError = error
    })
    child.stdout?.on('data', (chunk: Buffer | string) => {
      const output = chunk.toString()
      stdoutOutput += output
      process.stdout.write(output)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const output = chunk.toString()
      stderrOutput += output
      process.stderr.write(output)
    })
    child.once('close', (code, signal) => {
      void retireOwnedProcess(commandProcesses, ownedCommand).then(
        () => {
          if (spawnError) {
            reject(spawnError)
          } else if (stderrOutput.includes(PG_CONCURRENT_QUERY_DEPRECATION)) {
            reject(
              new Error(
                `Phase 10 shard ${shard} emitted the forbidden pg concurrent-query deprecation.`
              )
            )
          } else if (code === 0) {
            try {
              resolve(readShardResult(stdoutOutput))
            } catch (error: unknown) {
              reject(error)
            }
          } else {
            reject(
              new Error(
                `${ownedCommand.label} failed (` +
                  `${signal ?? `exit ${code ?? 'unknown'}`}).`
              )
            )
          }
        },
        (error: unknown) => reject(error)
      )
    })
  })

const cleanup = (): Promise<void> => {
  cleanupPromise ??= (async () => {
    const errors: unknown[] = []
    try {
      await stopOwnedProcesses(commandProcesses, {
        onForceKill: ({ label }) => {
          process.stderr.write(
            `[${label}] graceful stop timed out; sending SIGKILL.\n`
          )
        }
      })
      commandProcesses.length = 0
    } catch (error: unknown) {
      errors.push(error)
    }
    if (harnessPrepared) {
      try {
        await cleanupPhase7IsolatedDatabase()
        harnessPrepared = false
      } catch (error: unknown) {
        errors.push(error)
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        'Phase 10 API integration cleanup failed.'
      )
    }
  })()
  return cleanupPromise
}

const assertUniformShardMetadata = (
  entries: readonly Phase10ApiIntegrationManifestEntry[]
): { readonly databaseState: string; readonly isolation: string } => {
  const databaseStates = new Set(
    entries.map(({ databaseState }) => databaseState)
  )
  const isolations = new Set(entries.map(({ isolation }) => isolation))
  if (databaseStates.size !== 1 || isolations.size !== 1) {
    throw new Error(
      `Phase 10 shard metadata is inconsistent: ${entries[0]?.shard}.`
    )
  }
  const databaseState = entries[0]?.databaseState
  const isolation = entries[0]?.isolation
  if (!databaseState || !isolation) {
    throw new Error('Phase 10 integration shard is empty.')
  }
  return { databaseState, isolation }
}

const getShardSeedRuns = (
  entries: readonly Phase10ApiIntegrationManifestEntry[]
): number => {
  const policies = new Set(entries.map(({ seedPolicy }) => seedPolicy))
  if (policies.size !== 1) {
    throw new Error(
      `Phase 10 shard seed policy is inconsistent: ${entries[0]?.shard}.`
    )
  }
  const policy = entries[0]?.seedPolicy
  if (policy === 'canonical-twice') return 2
  if (policy === 'canonical-once') return 1
  if (policy === 'none') return 0
  throw new Error('Phase 10 integration shard seed policy is unavailable.')
}

const runShard = async (shard: string): Promise<Phase10ShardResult> => {
  await validatePhase10ApiIntegrationManifest()
  const entries = getPhase10ApiIntegrationEntriesByOwner('phase10').filter(
    (entry) => entry.shard === shard
  )
  if (entries.length === 0) {
    throw new Error(`Unknown Phase 10 integration shard: ${shard}.`)
  }
  const { databaseState, isolation } = assertUniformShardMetadata(entries)
  const seedRuns = getShardSeedRuns(entries)
  const isProcessOnly = entries.every(
    ({ connectionRole }) => connectionRole === 'none'
  )
  if (
    isProcessOnly &&
    (databaseState !== 'none' || seedRuns !== 0 || entries.length !== 1)
  ) {
    throw new Error(
      `Phase 10 process-only shard metadata is invalid: ${shard}.`
    )
  }
  const harness = isProcessOnly
    ? undefined
    : await preparePhase7IsolatedDatabase({ seedRuns })
  harnessPrepared = harness !== undefined
  let passedTestCount = 0

  for (const entry of entries) {
    const databaseUrl = harness
      ? entry.connectionRole === 'owner'
        ? harness.adminDatabaseUrl
        : entry.connectionRole === 'migration'
          ? harness.migrationDatabaseUrl
          : harness.applicationDatabaseUrl
      : undefined
    const environment: NodeJS.ProcessEnv = harness
      ? {
          ...harness.sharedEnvironment,
          DATABASE_URL: databaseUrl,
          PHASE10_APPLICATION_DATABASE_URL: harness.applicationDatabaseUrl,
          PHASE10_CURRENT_SOURCE_INTEGRATION: '1',
          PHASE10_FIXTURE_DATABASE_URL: harness.adminDatabaseUrl,
          PHASE10_INTEGRATION_SHARD: shard,
          PRISMA_TEST_DATABASE_URL: databaseUrl
        }
      : { ...process.env, PHASE10_INTEGRATION_SHARD: shard }
    passedTestCount += await runPhase10ManifestVitestFile({
      runCommand,
      testFile: entry.path,
      environment
    })
  }

  return {
    databaseState,
    executedFileCount: entries.length,
    isolation,
    passedTestCount,
    schemaName: harness?.schemaName ?? null,
    schemaRemoved: false,
    seedRuns,
    shard
  }
}

const runAllShards = async (): Promise<{
  readonly executedFileCount: number
  readonly executedShardCount: number
  readonly passedTestCount: number
}> => {
  await validatePhase10ApiIntegrationManifest()
  const entries = getPhase10ApiIntegrationEntriesByOwner('phase10')
  const shards = [...new Set(entries.map(({ shard }) => shard))]
  let executedFileCount = 0
  let passedTestCount = 0
  for (const shard of shards) {
    const result = await runShardProcess(shard)
    const expectedFileCount = entries.filter(
      (entry) => entry.shard === shard
    ).length
    if (
      result.shard !== shard ||
      result.executedFileCount !== expectedFileCount ||
      result.schemaRemoved !== (result.schemaName !== null)
    ) {
      throw new Error(
        `Phase 10 integration shard evidence is invalid: ${shard}.`
      )
    }
    executedFileCount += result.executedFileCount
    passedTestCount += result.passedTestCount
  }
  if (executedFileCount !== entries.length) {
    throw new Error('Phase 10 integration shard execution count is incomplete.')
  }
  return {
    executedFileCount,
    executedShardCount: shards.length,
    passedTestCount
  }
}

const shardArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith('--shard='))
const requestedShard = shardArgument?.slice('--shard='.length)

const execute = async (): Promise<void> => {
  if (requestedShard) {
    const result = await runShard(requestedShard)
    await cleanup()
    process.stdout.write(
      `${JSON.stringify({
        event: 'phase10.api_integration.shard.passed',
        ...result,
        schemaRemoved: result.schemaName !== null
      })}\n`
    )
    return
  }

  const result = await runAllShards()
  await cleanup()
  process.stdout.write(
    `${JSON.stringify({
      event: 'phase10.api_integration.current.passed',
      ...result
    })}\n`
  )
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void cleanup()
      .then(() => process.exit(signal === 'SIGINT' ? 130 : 143))
      .catch(() => process.exit(1))
  })
}

void execute().catch(async (error: unknown) => {
  try {
    await cleanup()
  } catch (cleanupError: unknown) {
    process.stderr.write(
      `${JSON.stringify({
        event: 'phase10.api_integration.cleanup_failed',
        errorName:
          cleanupError instanceof Error ? cleanupError.name : 'UnknownError'
      })}\n`
    )
  }
  process.stderr.write(
    `${JSON.stringify({
      event: 'phase10.api_integration.failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown failure'
    })}\n`
  )
  process.exitCode = 1
})

import { spawn, type ChildProcess } from 'node:child_process'
import { rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  cleanupPhase7IsolatedDatabase,
  preparePhase7IsolatedDatabase
} from './runPhase7ApiIntegration.js'
import { readPhase10DatabaseApiPerformanceEvidence } from './phase10PerformanceEvidence.js'
import { createPhase10PerformanceFailureFinalizer } from './phase10PerformanceFailureFinalizer.js'
import {
  exitPhase10PerformanceProcess,
  type Phase10PerformanceTerminalRecord
} from './phase10PerformanceProcessExit.js'
import {
  runPhase10CleanupWithTimeout,
  runWithPhase10Timeout
} from './phase10RunTimeout.js'
import { runPhase10ManifestVitestFile } from './phase10ApiIntegrationExecution.js'
import {
  retireOwnedProcess,
  shouldDetachOwnedProcess,
  stopOwnedProcesses
} from './ownedProcessGroup.js'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
)
const PERFORMANCE_TEST_FILE =
  'src/dashboard/dashboardInsightsPerformance.integration.test.ts'
const PERFORMANCE_RUN_TIMEOUT_MS = 10 * 60_000
const PERFORMANCE_CLEANUP_TIMEOUT_MS = 15_000
const PERFORMANCE_FINALIZER_TIMEOUT_MS = PERFORMANCE_CLEANUP_TIMEOUT_MS + 1_000
const PERFORMANCE_RUNNER_LABEL = 'Phase 10 database/API performance runner'
const executionAbortController = new globalThis.AbortController()
const ownedProcesses: Array<{ child: ChildProcess; label: string }> = []
let harnessCleanupRequired = false
let performanceEvidenceFile: string | undefined
let cleanupPromise: Promise<void> | undefined
let receivedSignal: 'SIGINT' | 'SIGTERM' | undefined
let resolveOperationSettled: (() => void) | undefined
const operationSettled = new Promise<void>((resolve) => {
  resolveOperationSettled = resolve
})
let signalFinalizationPromise: Promise<never> | undefined
let failureCompletionPromise: Promise<never> | undefined
let cleanupWithinDeadlinePromise: Promise<void> | undefined

const formatCommand = (command: string, args: readonly string[]): string =>
  [command, ...args].join(' ')

const runCommand = async (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  capture = false,
  abortSignal: AbortSignal = executionAbortController.signal
): Promise<string> => {
  abortSignal.throwIfAborted()
  let spawnError: Error | undefined
  let stdout = ''
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    detached: shouldDetachOwnedProcess,
    env: environment,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
  })
  const ownedProcess = { child, label: formatCommand(command, args) }
  ownedProcesses.push(ownedProcess)
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk
  })
  let handleAbort: (() => void) | undefined
  const childOutcome = new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
  }>((resolve) => {
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  const abortOutcome = new Promise<{ aborted: true }>((resolve) => {
    handleAbort = () => resolve({ aborted: true })
    abortSignal.addEventListener('abort', handleAbort, { once: true })
    if (abortSignal.aborted) handleAbort()
  })
  try {
    const outcome = await Promise.race([childOutcome, abortOutcome])
    await retireOwnedProcess(ownedProcesses, ownedProcess)
    abortSignal.throwIfAborted()
    if (spawnError) throw spawnError
    if ('aborted' in outcome) {
      throw new Error('Phase 10 command aborted without an abort reason.')
    }
    if (outcome.code === 0) return stdout.trim()
    throw new Error(
      `${ownedProcess.label} failed (` +
        `${outcome.signal ?? `exit ${outcome.code ?? 'unknown'}`}).`
    )
  } finally {
    if (handleAbort) abortSignal.removeEventListener('abort', handleAbort)
  }
}

const cleanup = (): Promise<void> => {
  cleanupPromise ??= (async () => {
    const errors: unknown[] = []
    try {
      await stopOwnedProcesses(ownedProcesses)
      ownedProcesses.length = 0
    } catch (error: unknown) {
      errors.push(error)
    }
    if (harnessCleanupRequired) {
      try {
        await cleanupPhase7IsolatedDatabase()
        harnessCleanupRequired = false
      } catch (error: unknown) {
        errors.push(error)
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Phase 10 performance cleanup failed.')
    }
  })()
  return cleanupPromise
}

const cleanupWithinDeadline = (): Promise<void> => {
  cleanupWithinDeadlinePromise ??= runPhase10CleanupWithTimeout({
    cleanup,
    label: PERFORMANCE_RUNNER_LABEL,
    timeoutMs: PERFORMANCE_CLEANUP_TIMEOUT_MS
  })
  return cleanupWithinDeadlinePromise
}

const finalizeFailure = createPhase10PerformanceFailureFinalizer({
  cleanup: cleanupWithinDeadline,
  cleanupTimeoutMs: PERFORMANCE_FINALIZER_TIMEOUT_MS,
  getEvidenceFile: () => performanceEvidenceFile,
  label: PERFORMANCE_RUNNER_LABEL
})

const completeFailure = (error: unknown): Promise<never> => {
  failureCompletionPromise ??= (async () => {
    const cleanupErrors = [...(await finalizeFailure())]
    const records: Phase10PerformanceTerminalRecord[] = cleanupErrors.map(
      (cleanupError) => ({
        destination: 'stderr',
        value: {
          errorName:
            cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
          event: 'phase10.database_api_performance.cleanup_failed'
        }
      })
    )
    records.push({
      destination: 'stderr',
      value: {
        cleanupErrorCount: cleanupErrors.length,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        event: 'phase10.database_api_performance.failed',
        message: error instanceof Error ? error.message : 'Unknown failure'
      }
    })
    const exitCode =
      receivedSignal && cleanupErrors.length === 0
        ? receivedSignal === 'SIGINT'
          ? 130
          : 143
        : 1
    return exitPhase10PerformanceProcess({ exitCode, records })
  })()
  return failureCompletionPromise
}

interface PerformanceRunResult {
  readonly apiP95Milliseconds: number
  readonly databaseP95Milliseconds: number
  readonly passedTestCount: number
}

const run = async (): Promise<PerformanceRunResult> => {
  const abortSignal = executionAbortController.signal
  abortSignal.throwIfAborted()
  const evidenceDirectory = path.resolve(
    process.env.PHASE10_PERFORMANCE_EVIDENCE_DIR ??
      path.join(repositoryRoot, 'test-results/phase10-evidence/performance')
  )
  const evidenceFile = path.join(evidenceDirectory, 'database-api.json')
  performanceEvidenceFile = evidenceFile
  await rm(evidenceFile, { force: true })
  abortSignal.throwIfAborted()
  const [commit, dirtyStatus, pnpmVersion] = await Promise.all([
    runCommand('git', ['rev-parse', 'HEAD'], process.env, true),
    runCommand(
      'git',
      ['status', '--porcelain', '--untracked-files=normal'],
      process.env,
      true
    ),
    runCommand('pnpm', ['--version'], process.env, true)
  ])
  abortSignal.throwIfAborted()
  harnessCleanupRequired = true
  const harness = await preparePhase7IsolatedDatabase({
    abortSignal,
    seedRuns: 1
  })
  abortSignal.throwIfAborted()
  const environment: NodeJS.ProcessEnv = {
    ...harness.sharedEnvironment,
    AUTH_GATEWAY_DATABASE_URL: harness.authGatewayDatabaseUrl,
    DATABASE_URL: harness.applicationDatabaseUrl,
    PHASE7_ADMIN_DATABASE_URL: harness.adminDatabaseUrl,
    PHASE10_PERFORMANCE_COMMIT: commit,
    PHASE10_PERFORMANCE_EVIDENCE_DIR: evidenceDirectory,
    PHASE10_PERFORMANCE_PNPM_VERSION: pnpmVersion,
    PHASE10_PERFORMANCE_SOURCE_TREE_DIRTY: String(dirtyStatus.length > 0),
    PRISMA_TEST_DATABASE_URL: harness.applicationDatabaseUrl
  }
  const passedTestCount = await runPhase10ManifestVitestFile({
    environment,
    runCommand: async (command, args, commandEnvironment) => {
      await runCommand(command, args, commandEnvironment)
    },
    testFile: PERFORMANCE_TEST_FILE
  })
  abortSignal.throwIfAborted()
  if (passedTestCount !== 1) {
    throw new Error('Phase 10 performance test count is invalid.')
  }
  const evidence = await readPhase10DatabaseApiPerformanceEvidence(evidenceFile)
  abortSignal.throwIfAborted()
  const evidenceMode = (await stat(evidenceFile)).mode & 0o777
  abortSignal.throwIfAborted()
  if (evidenceMode !== 0o600) {
    throw new Error('Phase 10 performance evidence mode is not 0600.')
  }
  return {
    apiP95Milliseconds: evidence.api.statisticsMs.p95,
    databaseP95Milliseconds: evidence.database.statisticsMs.p95,
    passedTestCount
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    receivedSignal ??= signal
    executionAbortController.abort(
      new Error(`Phase 10 performance runner received ${signal}.`)
    )
    signalFinalizationPromise ??= (async () => {
      await Promise.race([operationSettled, delay(5_000)])
      return await completeFailure(
        executionAbortController.signal.reason ??
          new Error(`Phase 10 performance runner received ${signal}.`)
      )
    })()
    void signalFinalizationPromise
  })
}

void runWithPhase10Timeout({
  abortSettleTimeoutMs: 5_000,
  cleanup: cleanupWithinDeadline,
  cleanupTimeoutMs: PERFORMANCE_FINALIZER_TIMEOUT_MS,
  label: PERFORMANCE_RUNNER_LABEL,
  onTimeout: () => {
    executionAbortController.abort(
      new Error('Phase 10 database/API performance runner timed out.')
    )
  },
  operation: async () => {
    try {
      return await run()
    } finally {
      resolveOperationSettled?.()
    }
  },
  timeoutMs: PERFORMANCE_RUN_TIMEOUT_MS
})
  .then(async (result) => {
    await cleanupWithinDeadline()
    if (receivedSignal) {
      return await completeFailure(
        executionAbortController.signal.reason ??
          new Error(`Phase 10 performance runner received ${receivedSignal}.`)
      )
    }
    return exitPhase10PerformanceProcess({
      exitCode: 0,
      records: [
        {
          destination: 'stdout',
          value: {
            ...result,
            event: 'phase10.database_api_performance.passed',
            schemaRemoved: true
          }
        }
      ]
    })
  })
  .catch(async (error: unknown) => await completeFailure(error))

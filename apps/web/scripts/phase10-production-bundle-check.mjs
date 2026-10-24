import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  assertPhase10BundleEvidenceProvenance,
  collectPhase10BundleEvidence,
  readPhase10BundleRepositoryState
} from './phase10-production-bundle-contract.mjs'
import {
  cleanupPhase10BundleEvidence,
  writeCanonicalBundleEvidence
} from './phase10-production-bundle-evidence-files.mjs'
import {
  shouldDetachOwnedProcess,
  stopOwnedProcesses
} from './phase10-owned-process-group.mjs'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(webRoot, '../..')
const defaultEvidenceDirectory = path.join(
  repositoryRoot,
  'test-results/phase10-evidence/performance'
)
const readTestTimeout = (name, fallback) => {
  if (process.env.NODE_ENV !== 'test' || process.env[name] === undefined) {
    return fallback
  }
  const timeoutMs = Number(process.env[name])
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`PHASE10_BUNDLE_TEST_TIMEOUT_INVALID:${name}`)
  }
  return timeoutMs
}
const commandTimeoutMs = readTestTimeout(
  'PHASE10_BUNDLE_TEST_COMMAND_TIMEOUT_MS',
  180_000
)
const ownedProcessStopOptions = {
  forceKillTimeoutMs: readTestTimeout(
    'PHASE10_BUNDLE_TEST_FORCE_KILL_TIMEOUT_MS',
    2_000
  ),
  gracefulTimeoutMs: readTestTimeout(
    'PHASE10_BUNDLE_TEST_GRACEFUL_TIMEOUT_MS',
    8_000
  )
}
const executionAbortController = new globalThis.AbortController()
const activeOwnedProcesses = new Set()
const ownedProcessCleanupPromises = new WeakMap()
let receivedSignal = null
let signalCleanupError = null
let signalCleanupPromise = Promise.resolve()

const cleanupOwnedProcess = (ownedProcess) => {
  let cleanupPromise = ownedProcessCleanupPromises.get(ownedProcess)
  if (!cleanupPromise) {
    cleanupPromise = stopOwnedProcesses(
      [ownedProcess],
      ownedProcessStopOptions
    ).finally(() => {
      activeOwnedProcesses.delete(ownedProcess)
    })
    ownedProcessCleanupPromises.set(ownedProcess, cleanupPromise)
  }
  return cleanupPromise
}

const stopActiveOwnedProcesses = async () => {
  await Promise.all([...activeOwnedProcesses].map(cleanupOwnedProcess))
}

const handleSignal = (signal) => {
  if (receivedSignal) return
  receivedSignal = signal
  executionAbortController.abort()
  signalCleanupPromise = stopActiveOwnedProcesses().catch((error) => {
    signalCleanupError = error
  })
}
const handleSigint = () => handleSignal('SIGINT')
const handleSigterm = () => handleSignal('SIGTERM')
process.once('SIGINT', handleSigint)
process.once('SIGTERM', handleSigterm)

const injectTestSignalAfterProvenance = async () => {
  const signal = process.env.PHASE10_BUNDLE_TEST_SIGNAL_AFTER_PROVENANCE
  if (process.env.NODE_ENV !== 'test' || !signal) return
  if (signal !== 'SIGINT' && signal !== 'SIGTERM') {
    throw new Error('PHASE10_BUNDLE_TEST_SIGNAL_INVALID')
  }
  process.kill(process.pid, signal)
  await new Promise((resolve, reject) => {
    const handleAbort = () => {
      globalThis.clearTimeout(timeoutHandle)
      resolve()
    }
    const timeoutHandle = globalThis.setTimeout(() => {
      executionAbortController.signal.removeEventListener('abort', handleAbort)
      reject(new Error('PHASE10_BUNDLE_TEST_SIGNAL_DELIVERY_TIMEOUT'))
    }, 5_000)
    executionAbortController.signal.addEventListener('abort', handleAbort, {
      once: true
    })
    if (executionAbortController.signal.aborted) handleAbort()
  })
}

const runCommand = async (command, args, options = {}) => {
  executionAbortController.signal.throwIfAborted()
  let timeoutHandle
  let spawnError
  const child = spawn(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    detached: shouldDetachOwnedProcess,
    env: options.environment ?? process.env,
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
  })
  const ownedProcess = {
    child,
    label: `${command} ${args.join(' ')}`
  }
  activeOwnedProcesses.add(ownedProcess)
  let stdout = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk) => {
    stdout += chunk
  })
  const childOutcome = new Promise((resolve) => {
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code, signal) => {
      resolve({ code, signal, timedOut: false })
    })
  })
  const timeoutOutcome = new Promise((resolve) => {
    timeoutHandle = globalThis.setTimeout(
      () => resolve({ code: null, signal: null, timedOut: true }),
      options.timeoutMs ?? commandTimeoutMs
    )
    timeoutHandle.unref?.()
  })
  try {
    const outcome = await Promise.race([childOutcome, timeoutOutcome])
    await cleanupOwnedProcess(ownedProcess)
    if (spawnError) throw spawnError
    if (outcome.timedOut) {
      throw new Error(`PHASE10_BUNDLE_COMMAND_TIMEOUT:${ownedProcess.label}`)
    }
    if (outcome.code === 0) return stdout.trim()
    throw new Error(
      `${ownedProcess.label} failed (` +
        `${outcome.signal ?? `exit ${outcome.code ?? 'unknown'}`}).`
    )
  } finally {
    if (timeoutHandle) globalThis.clearTimeout(timeoutHandle)
  }
}

const readVersions = async () => {
  const vitePackage = JSON.parse(
    await readFile(path.join(webRoot, 'node_modules/vite/package.json'), 'utf8')
  )
  return {
    node: process.version,
    pnpm: await runCommand('pnpm', ['--version'], { capture: true }),
    vite: String(vitePackage.version ?? '')
  }
}

const run = async () => {
  const evidenceDirectory = path.resolve(
    process.env.PHASE10_PERFORMANCE_EVIDENCE_DIR ?? defaultEvidenceDirectory
  )
  const evidenceFile = path.join(evidenceDirectory, 'bundle.json')
  await cleanupPhase10BundleEvidence(evidenceFile)
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'nihongo-phase10-bundle-')
  )
  const buildCommand = 'pnpm'
  const buildArgs = [
    'exec',
    'vite',
    'build',
    '--manifest',
    '.vite/phase10-manifest.json',
    '--ssrManifest',
    '.vite/phase10-ssr-manifest.json',
    '--outDir',
    temporaryRoot,
    '--emptyOutDir'
  ]
  const buildMetadataEnvironment = {
    apiBaseUrl: '/api',
    apiMode: 'real',
    nodeEnvironment: 'production'
  }
  const normalizedBuildCommand = [
    buildCommand,
    ...buildArgs.map((argument) =>
      argument === temporaryRoot ? '<temporary-out-dir>' : argument
    )
  ].join(' ')
  try {
    const sourceTreeBeforeBuild =
      await readPhase10BundleRepositoryState(repositoryRoot)
    await runCommand(buildCommand, buildArgs, {
      cwd: webRoot,
      environment: {
        ...process.env,
        NODE_ENV: buildMetadataEnvironment.nodeEnvironment,
        VITE_API_BASE_URL: buildMetadataEnvironment.apiBaseUrl,
        VITE_API_MODE: buildMetadataEnvironment.apiMode
      }
    })
    executionAbortController.signal.throwIfAborted()
    const [sourceTreeAfterBuild, versions] = await Promise.all([
      readPhase10BundleRepositoryState(repositoryRoot),
      readVersions()
    ])
    if (
      JSON.stringify(sourceTreeAfterBuild) !==
      JSON.stringify(sourceTreeBeforeBuild)
    ) {
      throw new Error('PHASE10_BUNDLE_SOURCE_CHANGED_DURING_BUILD')
    }
    const evidence = await collectPhase10BundleEvidence({
      distDirectory: temporaryRoot,
      metadata: {
        command: normalizedBuildCommand,
        commit: sourceTreeAfterBuild.commit,
        environment: buildMetadataEnvironment,
        generatedAt: new Date().toISOString(),
        mode: 'production',
        sourceTreeDirty: sourceTreeAfterBuild.sourceTreeDirty,
        sourceTreeSha256: sourceTreeAfterBuild.sourceTreeSha256,
        versions
      }
    })
    executionAbortController.signal.throwIfAborted()
    await writeCanonicalBundleEvidence(evidenceFile, evidence)
    executionAbortController.signal.throwIfAborted()
    await assertPhase10BundleEvidenceProvenance({
      evidence,
      repositoryRoot
    })
    executionAbortController.signal.throwIfAborted()
    await injectTestSignalAfterProvenance()
    executionAbortController.signal.throwIfAborted()
    process.stdout.write(
      `${JSON.stringify({
        event: 'phase10.bundle_performance.passed',
        evidenceFile: path.relative(repositoryRoot, evidenceFile),
        inventorySha256: evidence.inventory.sha256,
        matchesAcceptedBaseline: evidence.inventory.matchesAcceptedBaseline
      })}\n`
    )
  } catch (error) {
    await cleanupPhase10BundleEvidence(evidenceFile)
    throw error
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true })
  }
}

try {
  await run()
} catch (error) {
  if (!receivedSignal) throw error
} finally {
  await signalCleanupPromise
  if (receivedSignal) {
    const evidenceDirectory = path.resolve(
      process.env.PHASE10_PERFORMANCE_EVIDENCE_DIR ?? defaultEvidenceDirectory
    )
    await cleanupPhase10BundleEvidence(
      path.join(evidenceDirectory, 'bundle.json')
    )
  }
  process.off('SIGINT', handleSigint)
  process.off('SIGTERM', handleSigterm)
}
if (signalCleanupError) throw signalCleanupError
if (receivedSignal) {
  process.exitCode = receivedSignal === 'SIGINT' ? 130 : 143
}

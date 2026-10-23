import { access, writeFile } from 'node:fs/promises'
import { createPhase10PerformanceFailureFinalizer } from '../phase10PerformanceFailureFinalizer.js'
import { exitPhase10PerformanceProcess } from '../phase10PerformanceProcessExit.js'
import { Phase10CleanupTimeoutError } from '../phase10RunTimeout.js'

const evidenceFile = process.env.PHASE10_HUNG_CLEANUP_EVIDENCE_FILE
if (!evidenceFile) {
  throw new Error('PHASE10_HUNG_CLEANUP_EVIDENCE_FILE is required.')
}

await writeFile(evidenceFile, '{"status":"passed"}\n', {
  encoding: 'utf8',
  mode: 0o600
})

setInterval(() => undefined, 1_000)

const finalizeFailure = createPhase10PerformanceFailureFinalizer({
  cleanup: async () => await new Promise<never>(() => undefined),
  cleanupTimeoutMs: 30,
  getEvidenceFile: () => evidenceFile,
  label: 'Phase 10 hung cleanup probe'
})
const cleanupErrors = await finalizeFailure()
let evidenceRemoved = false
try {
  await access(evidenceFile)
} catch (error: unknown) {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    evidenceRemoved = true
  } else {
    throw error
  }
}

exitPhase10PerformanceProcess({
  exitCode: 1,
  records: [
    {
      destination: 'stderr',
      value: {
        cleanupTimedOut: cleanupErrors.some(
          (error) => error instanceof Phase10CleanupTimeoutError
        ),
        evidenceRemoved,
        event: 'phase10.hung_cleanup_probe.failed'
      }
    }
  ]
})

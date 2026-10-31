import { rm } from 'node:fs/promises'
import { runPhase10CleanupWithTimeout } from './phase10RunTimeout.js'

interface PerformanceFailureFinalizerOptions {
  readonly cleanup: () => Promise<void>
  readonly cleanupTimeoutMs: number
  readonly getEvidenceFile: () => string | undefined
  readonly label: string
}

export const createPerformanceFailureFinalizer = ({
  cleanup,
  cleanupTimeoutMs,
  getEvidenceFile,
  label
}: PerformanceFailureFinalizerOptions): (() => Promise<readonly unknown[]>) => {
  let finalizationPromise: Promise<readonly unknown[]> | undefined
  return () => {
    finalizationPromise ??= (async () => {
      const errors: unknown[] = []
      try {
        await runPhase10CleanupWithTimeout({
          cleanup,
          label,
          timeoutMs: cleanupTimeoutMs
        })
      } catch (error: unknown) {
        errors.push(error)
      }
      const evidenceFile = getEvidenceFile()
      if (evidenceFile) {
        try {
          await rm(evidenceFile, { force: true })
        } catch (error: unknown) {
          errors.push(error)
        }
      }
      return errors
    })()
    return finalizationPromise
  }
}

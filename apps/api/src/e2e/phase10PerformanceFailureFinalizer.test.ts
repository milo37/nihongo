import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPhase10PerformanceFailureFinalizer } from './phase10PerformanceFailureFinalizer.js'
import { Phase10CleanupTimeoutError } from './phase10RunTimeout.js'

const temporaryDirectories: string[] = []
const require = createRequire(import.meta.url)
const tsxCli = require.resolve('tsx/cli')
const hungCleanupProbe = fileURLToPath(
  new URL('./fixtures/phase10HungCleanupExitProbe.ts', import.meta.url)
)

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true })
    })
  )
})

describe('Phase 10 performance failure finalizer', () => {
  it('force-exits a subprocess with a referenced handle after deleting evidence', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'nihongo-phase10-hung-cleanup-process-')
    )
    temporaryDirectories.push(directory)
    const evidenceFile = path.join(directory, 'database-api.json')
    const startedAt = Date.now()
    let child: ChildProcess | undefined
    try {
      const outcome = await new Promise<{
        readonly code: number | null
        readonly signal: NodeJS.Signals | null
        readonly stderr: string
      }>((resolve, reject) => {
        child = spawn(process.execPath, [tsxCli, hungCleanupProbe], {
          env: {
            ...process.env,
            PHASE10_HUNG_CLEANUP_EVIDENCE_FILE: evidenceFile
          },
          stdio: ['ignore', 'ignore', 'pipe']
        })
        let stderr = ''
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (chunk: string) => {
          stderr += chunk
        })
        const timeoutHandle = globalThis.setTimeout(() => {
          reject(new Error('Hung cleanup subprocess did not force-exit.'))
        }, 2_000)
        child.once('error', (error) => {
          globalThis.clearTimeout(timeoutHandle)
          reject(error)
        })
        child.once('close', (code, signal) => {
          globalThis.clearTimeout(timeoutHandle)
          resolve({ code, signal, stderr })
        })
      })

      expect(outcome).toMatchObject({ code: 1, signal: null })
      expect(
        outcome.stderr
          .trim()
          .split('\n')
          .map((line): unknown => JSON.parse(line) as unknown)
      ).toEqual([
        {
          cleanupTimedOut: true,
          evidenceRemoved: true,
          event: 'phase10.hung_cleanup_probe.failed'
        }
      ])
      expect(Date.now() - startedAt).toBeLessThan(2_000)
      await expect(access(evidenceFile)).rejects.toMatchObject({
        code: 'ENOENT'
      })
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => {
          child?.once('close', () => resolve())
          child?.kill('SIGKILL')
        })
      }
    }
  })

  it('removes written evidence exactly once on signal finalization', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'nihongo-phase10-signal-finalizer-')
    )
    temporaryDirectories.push(directory)
    const evidenceFile = path.join(directory, 'database-api.json')
    await writeFile(evidenceFile, '{"status":"passed"}\n', {
      encoding: 'utf8',
      mode: 0o600
    })
    const cleanup = vi.fn(async () => undefined)
    const finalizeFailure = createPhase10PerformanceFailureFinalizer({
      cleanup,
      cleanupTimeoutMs: 100,
      getEvidenceFile: () => evidenceFile,
      label: 'Phase 10 performance runner'
    })

    const firstFinalization = finalizeFailure()
    const secondFinalization = finalizeFailure()
    expect(firstFinalization).toBe(secondFinalization)
    await expect(firstFinalization).resolves.toEqual([])
    expect(cleanup).toHaveBeenCalledTimes(1)
    await expect(access(evidenceFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('bounds a hung cleanup and still removes failure evidence', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'nihongo-phase10-hung-finalizer-')
    )
    temporaryDirectories.push(directory)
    const evidenceFile = path.join(directory, 'database-api.json')
    await writeFile(evidenceFile, '{"status":"passed"}\n', {
      encoding: 'utf8',
      mode: 0o600
    })
    const startedAt = Date.now()
    const finalizeFailure = createPhase10PerformanceFailureFinalizer({
      cleanup: async () => await new Promise<never>(() => undefined),
      cleanupTimeoutMs: 30,
      getEvidenceFile: () => evidenceFile,
      label: 'Phase 10 performance runner'
    })

    await expect(finalizeFailure()).resolves.toEqual([
      expect.any(Phase10CleanupTimeoutError)
    ])
    expect(Date.now() - startedAt).toBeLessThan(500)
    await expect(access(evidenceFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

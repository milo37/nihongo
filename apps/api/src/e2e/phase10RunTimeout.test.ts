import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  shouldDetachOwnedProcess,
  stopOwnedProcesses
} from './ownedProcessGroup.js'
import {
  Phase10CleanupTimeoutError,
  Phase10RunTimeoutError,
  runWithPhase10Timeout
} from './phase10RunTimeout.js'

const temporaryDirectories: string[] = []
const ownedProcesses: Array<{ child: ChildProcess; label: string }> = []

const readPidsWhenReady = async (
  filePath: string
): Promise<{ leaderPid: number; nestedPid: number }> => {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as {
        leaderPid: number
        nestedPid: number
      }
    } catch (error: unknown) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error
      }
      await delay(20)
    }
  }
  throw new Error('Timed out waiting for Phase 10 timeout test PIDs.')
}

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false
    }
    throw error
  }
}

afterEach(async () => {
  await stopOwnedProcesses(ownedProcesses, {
    forceKillTimeoutMs: 1_000,
    gracefulTimeoutMs: 50
  })
  ownedProcesses.length = 0
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true })
    })
  )
})

describe('Phase 10 runner timeout', () => {
  it('rejects within the cleanup deadline when cleanup never settles', async () => {
    const startedAt = Date.now()
    let cleanupStarted = false

    const rejection = runWithPhase10Timeout({
      abortSettleTimeoutMs: 20,
      cleanup: async () => {
        cleanupStarted = true
        await new Promise<never>(() => undefined)
      },
      cleanupTimeoutMs: 30,
      label: 'Phase 10 performance runner',
      onTimeout: () => undefined,
      operation: async () => await new Promise<never>(() => undefined),
      timeoutMs: 20
    })

    await expect(rejection).rejects.toMatchObject({
      errors: [
        expect.any(Phase10RunTimeoutError),
        expect.any(Phase10CleanupTimeoutError)
      ]
    })
    expect(cleanupStarted).toBe(true)
    expect(Date.now() - startedAt).toBeLessThan(500)
  })

  it.skipIf(process.platform === 'win32')(
    'fails within the bound and cleans a hung descendant process group',
    async () => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), 'nihongo-phase10-run-timeout-')
      )
      temporaryDirectories.push(directory)
      const pidFile = path.join(directory, 'pids.json')
      const child = spawn(
        process.execPath,
        [
          '-e',
          `const { spawn } = require('node:child_process');
           const { writeFileSync } = require('node:fs');
           process.on('SIGTERM', () => {});
           const nested = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
           writeFileSync(process.env.PHASE10_TIMEOUT_PID_FILE, JSON.stringify({ leaderPid: process.pid, nestedPid: nested.pid }));
           setInterval(() => {}, 1000);`
        ],
        {
          detached: shouldDetachOwnedProcess,
          env: { ...process.env, PHASE10_TIMEOUT_PID_FILE: pidFile },
          stdio: 'ignore'
        }
      )
      const ownedProcess = { child, label: 'hung Phase 10 command' }
      ownedProcesses.push(ownedProcess)
      const { leaderPid, nestedPid } = await readPidsWhenReady(pidFile)
      const abortController = new globalThis.AbortController()
      let lateStageStarted = false

      await expect(
        runWithPhase10Timeout({
          abortSettleTimeoutMs: 100,
          cleanup: async () =>
            await stopOwnedProcesses([ownedProcess], {
              forceKillTimeoutMs: 1_000,
              gracefulTimeoutMs: 50
            }),
          label: 'Phase 10 performance runner',
          onTimeout: () => abortController.abort(),
          operation: async () =>
            await new Promise<never>((_resolve, reject) => {
              abortController.signal.addEventListener(
                'abort',
                () => {
                  try {
                    abortController.signal.throwIfAborted()
                    lateStageStarted = true
                  } catch (error: unknown) {
                    reject(error)
                  }
                },
                { once: true }
              )
            }),
          timeoutMs: 50
        })
      ).rejects.toBeInstanceOf(Phase10RunTimeoutError)
      expect(abortController.signal.aborted).toBe(true)
      expect(lateStageStarted).toBe(false)
      expect(isProcessRunning(leaderPid)).toBe(false)
      expect(isProcessRunning(nestedPid)).toBe(false)
      ownedProcesses.length = 0
    }
  )
})

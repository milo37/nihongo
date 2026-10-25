import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  retireOwnedProcess,
  shouldDetachOwnedProcess,
  stopOwnedProcesses
} from './ownedProcessGroup.js'

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return !(
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ESRCH'
    )
  }
}

describe('owned process groups', () => {
  it('retains a command for final cleanup when its first retirement fails', async () => {
    const ownedProcess = {
      child: { pid: 424_242 } as ChildProcess,
      label: 'retryable-retirement-test'
    }
    const ownedProcesses = [ownedProcess]
    const stopProcesses = vi
      .fn<(processes: readonly (typeof ownedProcess)[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('first cleanup failed'))
      .mockResolvedValueOnce()

    await expect(
      retireOwnedProcess(ownedProcesses, ownedProcess, stopProcesses)
    ).rejects.toThrow('first cleanup failed')
    expect(ownedProcesses).toEqual([ownedProcess])

    await expect(
      retireOwnedProcess(ownedProcesses, ownedProcess, stopProcesses)
    ).resolves.toBeUndefined()
    expect(ownedProcesses).toEqual([])
  })

  it.runIf(shouldDetachOwnedProcess)(
    'accepts EPERM only after the process table proves no owned member remains',
    async () => {
      const child = { pid: 424_242 } as ChildProcess
      const permissionError = Object.assign(new Error('kill EPERM'), {
        code: 'EPERM'
      })
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw permissionError
      })

      try {
        await expect(
          stopOwnedProcesses([{ child, label: 'inaccessible-group-test' }], {
            readProcessGroupMemberPids: () => []
          })
        ).resolves.toBeUndefined()
        expect(killSpy).toHaveBeenCalledWith(-424_242, 0)
      } finally {
        killSpy.mockRestore()
      }
    }
  )

  it.runIf(shouldDetachOwnedProcess)(
    'waits for a leader state when the process group is already absent',
    async () => {
      let signalCode: NodeJS.Signals | null = null
      const child = {
        exitCode: null,
        get signalCode() {
          return signalCode
        },
        pid: 424_243
      } as ChildProcess
      const missingError = Object.assign(new Error('kill ESRCH'), {
        code: 'ESRCH'
      })
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw missingError
      })
      const stateTimer = setTimeout(() => {
        signalCode = 'SIGTERM'
      }, 25)

      try {
        await expect(
          stopOwnedProcesses([{ child, label: 'already-absent-group' }], {
            forceKillTimeoutMs: 250
          })
        ).resolves.toBeUndefined()
        expect(signalCode).toBe('SIGTERM')
      } finally {
        clearTimeout(stateTimer)
        killSpy.mockRestore()
      }
    }
  )

  it.runIf(shouldDetachOwnedProcess)(
    'rejects within the leader timeout when an absent group never reports exit',
    async () => {
      const child = {
        exitCode: null,
        pid: 424_244,
        signalCode: null
      } as ChildProcess
      const missingError = Object.assign(new Error('kill ESRCH'), {
        code: 'ESRCH'
      })
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw missingError
      })
      const startedAt = Date.now()

      try {
        await expect(
          stopOwnedProcesses([{ child, label: 'unreaped-leader' }], {
            forceKillTimeoutMs: 25
          })
        ).rejects.toThrow('Owned process groups did not stop: unreaped-leader')
        expect(Date.now() - startedAt).toBeLessThan(500)
      } finally {
        killSpy.mockRestore()
      }
    }
  )

  it.runIf(shouldDetachOwnedProcess)(
    'stops a command and its descendant before resolving',
    async () => {
      const child = spawn(
        process.execPath,
        [
          '-e',
          [
            "const { spawn } = require('node:child_process')",
            "process.on('SIGTERM', () => {})",
            `const nested = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready\\\\n'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] })`,
            `nested.stdout.once('data', () => process.stdout.write(String(nested.pid) + '\\n'))`,
            'setInterval(() => {}, 1000)'
          ].join(';')
        ],
        {
          detached: true,
          stdio: ['ignore', 'pipe', 'ignore']
        }
      )
      const descendantPid = await new Promise<number>((resolve, reject) => {
        child.once('error', reject)
        child.stdout?.once('data', (chunk: Buffer) => {
          resolve(Number(chunk.toString().trim()))
        })
      })
      const childPid = child.pid
      if (childPid === undefined || !Number.isSafeInteger(descendantPid)) {
        throw new Error('Process-group fixture did not expose valid PIDs.')
      }

      let forceKillCount = 0
      try {
        expect(isProcessAlive(childPid)).toBe(true)
        expect(isProcessAlive(descendantPid)).toBe(true)

        await stopOwnedProcesses([{ child, label: 'process-group-test' }], {
          gracefulTimeoutMs: 100,
          forceKillTimeoutMs: 1_000,
          onForceKill: () => {
            forceKillCount += 1
          }
        })

        expect(forceKillCount).toBe(1)
        expect(isProcessAlive(childPid)).toBe(false)
        expect(isProcessAlive(descendantPid)).toBe(false)
      } finally {
        if (isProcessAlive(childPid) || isProcessAlive(descendantPid)) {
          await stopOwnedProcesses([{ child, label: 'process-group-test' }], {
            gracefulTimeoutMs: 100,
            forceKillTimeoutMs: 1_000
          })
        }
      }
    }
  )

  it.runIf(shouldDetachOwnedProcess)(
    'stops a remaining descendant after the command leader exits',
    async () => {
      const child = spawn(
        process.execPath,
        [
          '-e',
          [
            "const { spawn } = require('node:child_process')",
            `const nested = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready\\\\n'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] })`,
            'nested.unref()',
            `nested.stdout.once('data', () => { process.stdout.write(String(nested.pid) + '\\n'); setTimeout(() => process.exit(0), 50) })`
          ].join(';')
        ],
        {
          detached: true,
          stdio: ['ignore', 'pipe', 'ignore']
        }
      )
      const descendantPid = await new Promise<number>((resolve, reject) => {
        child.once('error', reject)
        child.stdout?.once('data', (chunk: Buffer) => {
          resolve(Number(chunk.toString().trim()))
        })
      })
      const childPid = child.pid
      if (childPid === undefined || !Number.isSafeInteger(descendantPid)) {
        throw new Error('Leader-exit fixture did not expose valid PIDs.')
      }
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', () => resolve())
      })

      try {
        expect(isProcessAlive(childPid)).toBe(false)
        expect(isProcessAlive(descendantPid)).toBe(true)

        await stopOwnedProcesses([{ child, label: 'leader-exit-test' }], {
          gracefulTimeoutMs: 100,
          forceKillTimeoutMs: 1_000
        })

        expect(isProcessAlive(descendantPid)).toBe(false)
      } finally {
        if (isProcessAlive(descendantPid)) {
          await stopOwnedProcesses([{ child, label: 'leader-exit-test' }], {
            gracefulTimeoutMs: 100,
            forceKillTimeoutMs: 1_000
          })
        }
      }
    }
  )
})

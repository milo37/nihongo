import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
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

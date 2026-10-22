import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { cleanupPhase7BrowserResources } from './runPhase7Browser.js'

describe('Phase 7 and 8 browser cleanup caller', () => {
  it('preserves owned processes and withholds fixture and DB cleanup after stop failure', async () => {
    const owned = {
      child: { pid: 424_242 } as ChildProcess,
      label: 'owned-test'
    }
    const processes = [owned]
    const stopFailure = new Error('owned process is still alive')
    const closeControlServer = vi.fn(async () => undefined)
    const disconnectFixture = vi.fn(async () => undefined)
    const cleanupHarness = vi.fn(async () => undefined)

    await expect(
      cleanupPhase7BrowserResources(processes, {
        stopOwnedProcesses: async () => {
          throw stopFailure
        },
        closeControlServer,
        cleanupDatabase: async () => {
          await disconnectFixture()
          await cleanupHarness()
        }
      })
    ).rejects.toThrow()

    expect(processes).toEqual([owned])
    expect(processes[0]).toBe(owned)
    expect(closeControlServer).toHaveBeenCalledOnce()
    expect(disconnectFixture).not.toHaveBeenCalled()
    expect(cleanupHarness).not.toHaveBeenCalled()
  })

  it('clears records only after a successful stop and keeps normal cleanup order', async () => {
    const processes = [{ child: {} as ChildProcess, label: 'stopped-test' }]
    const calls: string[] = []
    await cleanupPhase7BrowserResources(processes, {
      stopOwnedProcesses: async () => {
        calls.push('stop')
      },
      closeControlServer: async () => {
        expect(processes).toEqual([])
        calls.push('control')
      },
      cleanupDatabase: async () => {
        calls.push('fixture')
        calls.push('database')
      }
    })
    expect(processes).toEqual([])
    expect(calls).toEqual(['stop', 'control', 'fixture', 'database'])
  })

  it('keeps database cleanup after successful stop even when the control close fails', async () => {
    const processes = [{ child: {} as ChildProcess, label: 'closed-test' }]
    const closeFailure = new Error('control close failed')
    const cleanupDatabase = vi.fn(async () => undefined)
    await expect(
      cleanupPhase7BrowserResources(processes, {
        stopOwnedProcesses: async () => undefined,
        closeControlServer: async () => {
          throw closeFailure
        },
        cleanupDatabase
      })
    ).rejects.toBe(closeFailure)
    expect(processes).toEqual([])
    expect(cleanupDatabase).toHaveBeenCalledOnce()
  })

  it('returns a database cleanup error after successful process shutdown', async () => {
    const processes = [
      { child: {} as ChildProcess, label: 'database-error-test' }
    ]
    const databaseFailure = new Error('database cleanup failed')
    await expect(
      cleanupPhase7BrowserResources(processes, {
        stopOwnedProcesses: async () => undefined,
        closeControlServer: async () => undefined,
        cleanupDatabase: async () => {
          throw databaseFailure
        }
      })
    ).rejects.toBe(databaseFailure)
    expect(processes).toEqual([])
  })
})

import { describe, expect, it, vi } from 'vitest'
import { cleanupPhase10BrowserResources } from './phase10BrowserCleanup.js'

describe('cleanupPhase10BrowserResources', () => {
  it('closes the control listener and withholds database cleanup after process-stop failure', async () => {
    const stopFailure = new Error('owned process stop failed')
    const closeControlServer = vi.fn(async () => undefined)
    const cleanupDatabase = vi.fn(async () => undefined)

    const failure = await cleanupPhase10BrowserResources({
      closeControlServer,
      cleanupDatabase,
      stopOwnedProcesses: async () => {
        throw stopFailure
      }
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([
      stopFailure,
      expect.objectContaining({
        message:
          'Phase 10 database cleanup was withheld because an owned process may still be running.'
      })
    ])
    expect(closeControlServer).toHaveBeenCalledOnce()
    expect(cleanupDatabase).not.toHaveBeenCalled()
  })

  it('still cleans the database when closing the control listener fails', async () => {
    const closeFailure = new Error('control close failed')
    const cleanupDatabase = vi.fn(async () => undefined)

    await expect(
      cleanupPhase10BrowserResources({
        closeControlServer: async () => {
          throw closeFailure
        },
        cleanupDatabase,
        stopOwnedProcesses: async () => undefined
      })
    ).rejects.toBe(closeFailure)
    expect(cleanupDatabase).toHaveBeenCalledOnce()
  })
})

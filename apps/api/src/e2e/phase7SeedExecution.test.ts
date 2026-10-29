import { describe, expect, it, vi } from 'vitest'
import { runPhase7SeedExecution } from './phase7SeedExecution.js'

describe('prefix seed repetition', () => {
  it('reports completion only after the prefix reseed command succeeds', async () => {
    const report = vi.fn()
    const command = vi.fn().mockResolvedValue(undefined)
    await runPhase7SeedExecution('PREFIX_RESEED', command, report)
    expect(command).toHaveBeenCalledOnce()
    expect(report.mock.calls).toEqual([
      ['PREFIX_RESEED', 'BEGIN'],
      ['PREFIX_RESEED', 'COMPLETE']
    ])
  })
  it('propagates failure without claiming completion', async () => {
    const report = vi.fn()
    const failure = new Error('prefix seed failed')
    await expect(
      runPhase7SeedExecution(
        'PREFIX_RESEED',
        async () => {
          throw failure
        },
        report
      )
    ).rejects.toBe(failure)
    expect(report.mock.calls).toEqual([
      ['PREFIX_RESEED', 'BEGIN'],
      ['PREFIX_RESEED', 'FAILED']
    ])
  })
})

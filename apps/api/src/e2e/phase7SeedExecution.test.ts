import { describe, expect, it } from 'vitest'
import {
  runPhase7SeedExecution,
  type Phase7SeedPhaseState
} from './phase7SeedExecution.js'

describe('normal Phase7 seed phase boundary', () => {
  it.each(['FIRST_NORMAL_SEED', 'RESEED'] as const)(
    '%s reports completion after exactly one command',
    async (phase) => {
      const events: Array<readonly [string, Phase7SeedPhaseState]> = []
      let calls = 0
      await runPhase7SeedExecution(
        phase,
        async () => {
          calls += 1
          expect(events).toEqual([[phase, 'BEGIN']])
        },
        (p, state) => events.push([p, state])
      )
      expect(calls).toBe(1)
      expect(events).toEqual([
        [phase, 'BEGIN'],
        [phase, 'COMPLETE']
      ])
    }
  )
  it.each(['FIRST_NORMAL_SEED', 'RESEED'] as const)(
    '%s preserves primary failure identity and never reports completion',
    async (phase) => {
      const failure = new Error('SYNTHETIC_SECRET')
      const events: Array<readonly [string, Phase7SeedPhaseState]> = []
      await expect(
        runPhase7SeedExecution(
          phase,
          async () => {
            throw failure
          },
          (p, state) => events.push([p, state])
        )
      ).rejects.toBe(failure)
      expect(events).toEqual([
        [phase, 'BEGIN'],
        [phase, 'FAILED']
      ])
      expect(JSON.stringify(events)).not.toContain('SYNTHETIC_SECRET')
    }
  )
})

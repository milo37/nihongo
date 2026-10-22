import { describe, expect, it } from 'vitest'
import { preparePhase7IsolatedDatabase } from './runPhase7ApiIntegration.js'

describe('Phase 7 isolated database abort boundary', () => {
  it('rejects an already-aborted run before connection or child startup', async () => {
    const abortController = new globalThis.AbortController()
    abortController.abort()

    await expect(
      preparePhase7IsolatedDatabase({
        abortSignal: abortController.signal,
        seedRuns: 1
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

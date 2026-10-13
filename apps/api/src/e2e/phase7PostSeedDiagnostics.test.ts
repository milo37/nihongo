import { describe, expect, it } from 'vitest'
import { getPhase10ApiIntegrationPathsByOwner } from './phase10ApiIntegrationManifest.js'
import {
  getPostSeedErrorCode,
  runPostSeedDiagnostic,
  type PostSeedDiagnostic,
  type PostSeedOperation
} from './phase7PostSeedDiagnostics.js'

const file = getPhase10ApiIntegrationPathsByOwner('phase7-db')[0]!

describe('post-reseed finite diagnostics', () => {
  for (const operation of ['COUNT', 'FILE', 'CLEANUP'] as const) {
    it(`${operation} preserves command result and execution order`, async () => {
      const events: Array<PostSeedDiagnostic | 'command'> = []
      const result = await runPostSeedDiagnostic(
        operation,
        async () => {
          events.push('command')
          return 65
        },
        (event) => events.push(event),
        file
      )
      expect(result).toBe(65)
      const path = operation === 'FILE' ? { file } : {}
      expect(events).toEqual([
        { stage: `${operation}_BEGIN`, ...path },
        'command',
        { stage: `${operation}_COMPLETE`, ...path }
      ])
    })

    it(`${operation} emits failure and rethrows the identical primary error`, async () => {
      const events: PostSeedDiagnostic[] = []
      const error = Object.assign(new Error('private message'), {
        code: '42501'
      })
      await expect(
        runPostSeedDiagnostic(
          operation,
          async () => {
            throw error
          },
          (event) => events.push(event),
          file
        )
      ).rejects.toBe(error)
      const path = operation === 'FILE' ? { file } : {}
      expect(events).toEqual([
        { stage: `${operation}_BEGIN`, ...path },
        { stage: `${operation}_FAILED`, ...path, errorCode: '42501' }
      ])
      expect(JSON.stringify(events)).not.toContain('private message')
    })
  }

  it('excludes dynamic paths and paths owned by another manifest runner', async () => {
    for (const path of [
      '/tmp/private/path',
      'src/unknown.integration.test.ts'
    ]) {
      const events: PostSeedDiagnostic[] = []
      await runPostSeedDiagnostic(
        'FILE',
        async () => undefined,
        (event) => events.push(event),
        path
      )
      expect(events).toEqual([
        { stage: 'FILE_BEGIN' },
        { stage: 'FILE_COMPLETE' }
      ])
    }
  })

  it('does not invoke code getters or inspect message, stack or inherited values', () => {
    let invoked = false
    const error = {
      get code() {
        invoked = true
        throw new Error('secret')
      }
    }
    expect(getPostSeedErrorCode(error)).toBe('UNKNOWN_REDACTED')
    expect(invoked).toBe(false)
    expect(getPostSeedErrorCode(Object.create({ code: '23514' }))).toBe(
      'UNKNOWN_REDACTED'
    )
    expect(getPostSeedErrorCode({ code: 'secret' })).toBe('UNKNOWN_REDACTED')
    expect(getPostSeedErrorCode(null)).toBe('UNKNOWN_REDACTED')
  })

  it('retains the count, file and cleanup command sequence', async () => {
    const executed: PostSeedOperation[] = []
    for (const operation of ['COUNT', 'FILE', 'CLEANUP'] as const) {
      await runPostSeedDiagnostic(
        operation,
        async () => {
          executed.push(operation)
        },
        () => undefined,
        file
      )
    }
    expect(executed).toEqual(['COUNT', 'FILE', 'CLEANUP'])
  })
})

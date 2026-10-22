import { describe, expect, it, vi } from 'vitest'
import {
  classifySeedFailure,
  getSeedFailureSqlState,
  writeSeedDiagnostic,
  sanitizeSeedLine,
  seedStages
} from './seedDiagnostics.js'
describe('safe seed diagnostics', () => {
  it('only classifies exact known conditions', () => {
    expect(
      classifySeedFailure(new Error('Question seed identity invariant failed.'))
    ).toBe('IDENTITY')
    expect(
      classifySeedFailure(
        new Error('SYSTEM_SEED reviewed mapping digest drifted.')
      )
    ).toBe('UNKNOWN_REDACTED')
    for (const value of [
      new Error('prefix SYSTEM_SEED reviewed mapping digest drifted.'),
      new Error('postgres://secret/password'),
      { message: 'Question seed identity invariant failed.' },
      null
    ])
      expect(classifySeedFailure(value)).toBe('UNKNOWN_REDACTED')
  })
  it('projects only fixed stages and ids without arbitrary fields', () => {
    for (const stage of seedStages) {
      const safe = sanitizeSeedLine(
        JSON.stringify({
          seedDiagnostic: 1,
          stage,
          diagnosticId: 'UNKNOWN_REDACTED',
          stack: 'secret',
          url: 'postgres://password',
          environment: 'token'
        })
      )
      expect(JSON.parse(safe!)).toEqual({
        seedDiagnostic: 1,
        stage,
        diagnosticId: 'UNKNOWN_REDACTED'
      })
      expect(safe).not.toMatch(
        /secret|postgres|password|token|stack|environment/
      )
    }
  })
  it('discards malformed, excessive, and unrecognized output', () => {
    for (const line of [
      'raw token error',
      'null',
      '{}',
      'x'.repeat(513),
      JSON.stringify({ seedDiagnostic: 1, stage: 'secret' }),
      JSON.stringify({
        seedDiagnostic: 1,
        stage: 'DONE',
        diagnosticId: 'secret'
      })
    ])
      expect(sanitizeSeedLine(line)).toBeNull()
  })
})

describe('structured database diagnostics', () => {
  const payload = {
    originalCode: '23514',
    originalMessage: 'SYSTEM_SEED reviewed mapping digest drifted.'
  }
  it('requires the exact paired database code and message', () => {
    expect(classifySeedFailure({ cause: payload })).toBe('CATALOG_DIGEST')
    for (const value of [
      { cause: { ...payload, originalCode: '99999' } },
      {
        cause: {
          ...payload,
          originalMessage: 'prefix ' + payload.originalMessage
        }
      },
      { cause: { originalCode: '23514' } },
      { message: payload.originalMessage }
    ])
      expect(classifySeedFailure(value)).toBe('UNKNOWN_REDACTED')
  })
  it('bounds traversal, cycles, and avoids getters', () => {
    expect(
      classifySeedFailure({ cause: { cause: { cause: { cause: payload } } } })
    ).toBe('UNKNOWN_REDACTED')
    const cycle: { cause?: unknown } = {}
    cycle.cause = cycle
    expect(classifySeedFailure(cycle)).toBe('UNKNOWN_REDACTED')
    expect(
      classifySeedFailure(
        Object.defineProperty({}, 'cause', {
          get: () => {
            throw Error('secret')
          }
        })
      )
    ).toBe('UNKNOWN_REDACTED')
  })
  it('preserves distinct primary and cleanup markers but removes raw fields', () => {
    for (const failureKind of ['PRIMARY_FAILURE', 'CLEANUP_FAILURE']) {
      const safe = sanitizeSeedLine(
        JSON.stringify({
          seedDiagnostic: 1,
          stage: 'WRITE_CALLBACK_DONE',
          failureKind,
          diagnosticId: 'CATALOG_DIGEST',
          raw: 'password'
        })
      )
      expect(JSON.parse(safe!)).toEqual({
        seedDiagnostic: 1,
        stage: 'WRITE_CALLBACK_DONE',
        failureKind,
        diagnosticId: 'CATALOG_DIGEST'
      })
    }
    expect(
      sanitizeSeedLine(
        JSON.stringify({
          seedDiagnostic: 1,
          stage: 'DONE',
          failureKind: 'secret'
        })
      )
    ).toBeNull()
  })
})

describe('fixed Prisma metadata path', () => {
  const payload = {
    originalCode: '23514',
    originalMessage: 'SYSTEM_SEED reviewed mapping digest drifted.'
  }
  const wrap = (value: unknown) => ({
    meta: { driverAdapterError: { cause: value } }
  })
  it('accepts exactly four objects and requires paired fields', () => {
    expect(classifySeedFailure(wrap(payload))).toBe('CATALOG_DIGEST')
    expect(
      classifySeedFailure(wrap({ ...payload, originalCode: '23505' }))
    ).toBe('UNKNOWN_REDACTED')
    expect(
      classifySeedFailure(
        wrap({
          ...payload,
          originalMessage: 'prefix ' + payload.originalMessage
        })
      )
    ).toBe('UNKNOWN_REDACTED')
    expect(classifySeedFailure(wrap({ originalCode: '23514' }))).toBe(
      'UNKNOWN_REDACTED'
    )
  })
  it('rejects fake metadata, over-budget wrappers and cycles', () => {
    for (const value of [
      { meta: { other: payload } },
      { meta: { driverAdapterError: payload } },
      { cause: wrap(payload) },
      wrap({ cause: payload })
    ])
      expect(classifySeedFailure(value)).toBe('UNKNOWN_REDACTED')
    const cycle: { meta?: unknown } = {}
    cycle.meta = cycle
    expect(classifySeedFailure(cycle)).toBe('UNKNOWN_REDACTED')
  })
  it('does not evaluate getters at any fixed path boundary', () => {
    const getter = (key: string) =>
      Object.defineProperty({}, key, {
        get: () => {
          throw Error('password')
        }
      })
    for (const value of [
      getter('meta'),
      { meta: getter('driverAdapterError') },
      { meta: { driverAdapterError: getter('cause') } },
      wrap(getter('originalMessage'))
    ])
      expect(classifySeedFailure(value)).toBe('UNKNOWN_REDACTED')
  })
})

describe('same-cause primary SQLSTATE diagnostics', () => {
  const count = 'SYSTEM_SEED may only commit the canonical 65-question catalog.'
  const digest = 'SYSTEM_SEED reviewed mapping digest drifted.'
  it('classifies both exact payload conventions without mixing fields', () => {
    for (const [message, id] of [
      [count, 'CATALOG_COUNT'],
      [digest, 'CATALOG_DIGEST']
    ] as const) {
      for (const payload of [
        { originalCode: '23514', originalMessage: message },
        { code: '23514', message }
      ]) {
        expect(classifySeedFailure({ cause: payload })).toBe(id)
        expect(getSeedFailureSqlState({ cause: payload })).toBe('23514')
        expect(
          classifySeedFailure({
            meta: { driverAdapterError: { cause: payload } }
          })
        ).toBe(id)
      }
    }
  })
  it('does not combine code and message from separate objects or conventions', () => {
    for (const payload of [
      { originalCode: '23514', cause: { originalMessage: count } },
      { originalCode: '23514', message: count },
      { code: '23514', originalMessage: count },
      { originalCode: '23503', originalMessage: count },
      { originalCode: '23514', originalMessage: count + ' suffix' }
    ])
      expect(classifySeedFailure(payload)).toBe('UNKNOWN_REDACTED')
  })
  it('reports observed 23514 independently of unknown message identity', () => {
    const payload = { code: '23514', message: 'SYNTHETIC_SECRET' }
    expect(classifySeedFailure({ cause: payload })).toBe('UNKNOWN_REDACTED')
    expect(getSeedFailureSqlState({ cause: payload })).toBe('23514')
    expect(getSeedFailureSqlState({ cause: { code: '23503' } })).toBeUndefined()
  })
  it('keeps four-object budget, cycle and getter protections for new count ID', () => {
    const payload = { code: '23514', message: count }
    expect(
      classifySeedFailure({ cause: { cause: { cause: { cause: payload } } } })
    ).toBe('UNKNOWN_REDACTED')
    const cycle: { cause?: unknown } = {}
    cycle.cause = cycle
    expect(getSeedFailureSqlState(cycle)).toBeUndefined()
    const getter = vi.fn(() => {
      throw Error('SYNTHETIC_SECRET')
    })
    expect(
      classifySeedFailure(
        Object.defineProperty({ code: '23514' }, 'message', { get: getter })
      )
    ).toBe('UNKNOWN_REDACTED')
    expect(getter).not.toHaveBeenCalled()
  })
  it('retains safe primary code and drops raw fields on sanitized output', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    try {
      writeSeedDiagnostic(
        'WRITE_CALLBACK_DONE',
        { cause: { code: '23514', message: 'SYNTHETIC_SECRET' } },
        'PRIMARY_FAILURE'
      )
      const line = spy.mock.calls[0]?.[0]
      expect(typeof line).toBe('string')
      const safe = sanitizeSeedLine(String(line))
      expect(JSON.parse(safe!)).toEqual({
        seedDiagnostic: 1,
        stage: 'WRITE_CALLBACK_DONE',
        failureKind: 'PRIMARY_FAILURE',
        diagnosticId: 'UNKNOWN_REDACTED',
        sqlstate: '23514'
      })
      expect(safe).not.toContain('SYNTHETIC_SECRET')
    } finally {
      spy.mockRestore()
    }
  })
  it('sanitizer allows the new ID but rejects unapproved SQLSTATE payloads', () => {
    const base = {
      seedDiagnostic: 1,
      stage: 'WRITE_CALLBACK_DONE',
      diagnosticId: 'CATALOG_COUNT'
    }
    expect(
      sanitizeSeedLine(
        JSON.stringify({ ...base, sqlstate: '23514', stack: 'SECRET' })
      )
    ).not.toContain('SECRET')
    for (const sqlstate of ['23503', 'SECRET', 23514, null])
      expect(sanitizeSeedLine(JSON.stringify({ ...base, sqlstate }))).toBeNull()
  })
})

it('does not execute Error message getters while classifying fixed conditions', () => {
  const getter = vi.fn(() => {
    throw Error('SYNTHETIC_SECRET')
  })
  const error = Object.defineProperty(new Error('fixture'), 'message', {
    get: getter
  })
  expect(classifySeedFailure(error)).toBe('UNKNOWN_REDACTED')
  expect(getSeedFailureSqlState(error)).toBeUndefined()
  expect(getter).not.toHaveBeenCalled()
})

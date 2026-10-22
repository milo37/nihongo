import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { ApplicationError } from '../errors/applicationError.js'
import { parseRawQueryRecord, parseStrictRawQuery } from './rawQuery.js'

const expectValidationError = (operation: () => unknown): void => {
  try {
    operation()
    throw new Error('Expected validation error.')
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ApplicationError)
    expect((error as ApplicationError).code).toBe('VALIDATION_ERROR')
  }
}

describe('raw Phase 7 query parsing', () => {
  it('preserves literal astral Unicode mixed with percent-encoded UTF-8', () => {
    const record = parseRawQueryRecord(
      '/api/v1/admin/tags?q=😀%20%E6%97%A5%E6%9C%AC'
    )

    expect(record).toEqual({ q: ['😀 日本'] })
    expect(Object.getPrototypeOf(record)).toBeNull()
  })

  it('rejects malformed percent bytes and fatal UTF-8', () => {
    expectValidationError(() =>
      parseStrictRawQuery(
        '/api/v1/admin/tags?q=%E3%81',
        z.object({ q: z.string() }).strict(),
        'invalid'
      )
    )
    expectValidationError(() =>
      parseStrictRawQuery(
        '/api/v1/admin/tags?q=%GG',
        z.object({ q: z.string() }).strict(),
        'invalid'
      )
    )
  })

  it('preserves duplicates then rejects scalar duplicate and reserved keys', () => {
    expect(parseRawQueryRecord('/api/v1/admin/tags?q=a&q=b')).toEqual({
      q: ['a', 'b']
    })
    expectValidationError(() =>
      parseStrictRawQuery(
        '/api/v1/admin/tags?q=a&q=b',
        z.object({ q: z.string() }).strict(),
        'invalid'
      )
    )
    expect(() =>
      parseRawQueryRecord('/api/v1/admin/tags?__proto__=pollution')
    ).toThrow()
  })
})

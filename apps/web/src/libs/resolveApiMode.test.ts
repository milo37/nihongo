import { describe, expect, it } from 'vitest'
import { resolveApiMode } from '@libs/resolveApiMode'

describe('resolveApiMode', () => {
  it('defaults development and test builds to mock', () => {
    expect(
      resolveApiMode({ configuredMode: undefined, isProduction: false })
    ).toBe('mock')
    expect(resolveApiMode({ configuredMode: '', isProduction: false })).toBe(
      'mock'
    )
  })

  it('defaults production builds to real', () => {
    expect(
      resolveApiMode({ configuredMode: undefined, isProduction: true })
    ).toBe('real')
  })

  it('accepts only exact mock and real values', () => {
    expect(
      resolveApiMode({ configuredMode: 'mock', isProduction: false })
    ).toBe('mock')
    expect(resolveApiMode({ configuredMode: 'real', isProduction: true })).toBe(
      'real'
    )
    expect(() =>
      resolveApiMode({ configuredMode: 'MOCK', isProduction: false })
    ).toThrow('must be exactly')
    expect(() =>
      resolveApiMode({ configuredMode: ' real ', isProduction: false })
    ).toThrow('must be exactly')
  })

  it('rejects an explicit mock mode in production', () => {
    expect(() =>
      resolveApiMode({ configuredMode: 'mock', isProduction: true })
    ).toThrow('forbidden in production')
  })
})

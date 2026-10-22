import { describe, expect, it } from 'vitest'
import { toBoundedDurationMs, toHttpStatusClass } from './httpLog.js'

describe('HTTP operational log normalization', () => {
  it('coarsens statuses without recording the exact code', () => {
    expect([199, 204, 302, 404, 503].map(toHttpStatusClass)).toEqual([
      '1xx',
      '2xx',
      '3xx',
      '4xx',
      '5xx'
    ])
  })

  it('rounds and bounds durations', () => {
    expect(toBoundedDurationMs(10, 11.6)).toBe(2)
    expect(toBoundedDurationMs(10, 50_000)).toBe(30_000)
    expect(toBoundedDurationMs(undefined, 20)).toBe(0)
    expect(toBoundedDurationMs(20, 10)).toBe(0)
  })
})

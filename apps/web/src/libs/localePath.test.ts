import { describe, expect, it } from 'vitest'
import {
  readPathLocale,
  stripLocalePrefix
} from '@nihongo/browser/libs/localePath'

describe('/ja address (#1268)', () => {
  it.each([
    ['/ja', '/'],
    ['/ja/practice', '/practice'],
    ['/ja/legal', '/legal'],
    ['/ja/support', '/support'],
    ['/', '/'],
    ['/practice', '/practice'],
    ['/jazz', '/jazz'],
    ['/japan/practice', '/japan/practice']
  ])('strips the prefix: %s -> %s', (pathname, expected) => {
    expect(stripLocalePrefix(pathname)).toBe(expected)
  })

  it.each([
    ['/ja', 'ja'],
    ['/ja/practice', 'ja'],
    ['/', null],
    ['/practice', null],
    ['/jazz', null]
  ])('reads the language: %s -> %s', (pathname, expected) => {
    expect(readPathLocale(pathname)).toBe(expected)
  })
})

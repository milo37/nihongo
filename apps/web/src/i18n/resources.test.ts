import { describe, expect, it } from 'vitest'
import { jaResources, koResources } from '@/i18n/resources'

const requiredNamespaces = [
  'common',
  'navigation',
  'auth',
  'practice',
  'result',
  'dashboard',
  'wrongNote',
  'bookmark',
  'admin',
  'errors',
  'a11y'
] as const

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const flattenCatalog = (
  value: unknown,
  prefix = '',
  entries = new Map<string, string>()
): Map<string, string> => {
  if (typeof value === 'string') {
    entries.set(prefix, value)
    return entries
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid catalog node at ${prefix || '<root>'}`)
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    flattenCatalog(nestedValue, prefix ? `${prefix}.${key}` : key, entries)
  }

  return entries
}

const getInterpolationParameters = (message: string): string[] => {
  return Array.from(
    message.matchAll(/\{\{\s*([^},\s]+)/gu),
    (match) => match[1]
  )
    .filter((value): value is string => Boolean(value))
    .sort()
}

describe('i18n resource contracts', () => {
  it('required namespace와 KO/JA exact key parity를 유지한다', () => {
    expect(Object.keys(koResources)).toEqual(
      expect.arrayContaining([...requiredNamespaces])
    )
    const ko = flattenCatalog(koResources)
    const ja = flattenCatalog(jaResources)

    expect([...ja.keys()].sort()).toEqual([...ko.keys()].sort())
    expect([...ko.values()].every((value) => value.trim().length > 0)).toBe(
      true
    )
    expect([...ja.values()].every((value) => value.trim().length > 0)).toBe(
      true
    )
  })

  it('interpolation parameter parity를 유지하고 raw HTML을 금지한다', () => {
    const ko = flattenCatalog(koResources)
    const ja = flattenCatalog(jaResources)
    const rawHtmlPattern = /<\/?[a-z][^>]*>/iu

    for (const [key, koMessage] of ko) {
      const jaMessage = ja.get(key)
      expect(jaMessage, key).toBeDefined()
      expect(getInterpolationParameters(jaMessage ?? ''), key).toEqual(
        getInterpolationParameters(koMessage)
      )
      expect(rawHtmlPattern.test(koMessage), key).toBe(false)
      expect(rawHtmlPattern.test(jaMessage ?? ''), key).toBe(false)
    }
  })
})

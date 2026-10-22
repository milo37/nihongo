import { afterEach, describe, expect, it, vi } from 'vitest'
import { cachedStorage, clearStorageCache } from '@libs/storage'
import {
  parseUiLocalePreference,
  readFreshUiLocalePreference,
  readUiLocalePreference,
  UI_LOCALE_STORAGE_KEY,
  writeUiLocalePreference
} from '@libs/localeStorage'

describe('locale storage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    cachedStorage.removeItem(UI_LOCALE_STORAGE_KEY)
    clearStorageCache()
  })

  it.each([
    null,
    '',
    '{',
    '[]',
    '{}',
    '{"version":2,"locale":"ja"}',
    '{"version":1,"locale":"en"}',
    '{"version":1,"locale":"ja","extra":true}'
  ])('missing/corrupt/unknown preference %s를 ko로 처리한다', (value) => {
    expect(parseUiLocalePreference(value)).toBe('ko')
  })

  it('exact v1 envelope를 저장하고 cached/fresh read에서 재현한다', () => {
    expect(writeUiLocalePreference('ja')).toBe(true)
    expect(window.localStorage.getItem(UI_LOCALE_STORAGE_KEY)).toBe(
      '{"version":1,"locale":"ja"}'
    )
    expect(readUiLocalePreference()).toBe('ja')
    expect(readFreshUiLocalePreference()).toBe('ja')
  })

  it('blocked read/write는 ko fail-safe 또는 실패로 처리한다', () => {
    vi.spyOn(cachedStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(readUiLocalePreference()).toBe('ko')

    vi.restoreAllMocks()
    vi.spyOn(cachedStorage, 'setItem').mockReturnValue(false)
    expect(writeUiLocalePreference('ja')).toBe(false)

    vi.restoreAllMocks()
    vi.spyOn(cachedStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(writeUiLocalePreference('ja')).toBe(false)
  })
})

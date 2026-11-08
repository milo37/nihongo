import { createHash } from 'node:crypto'
import { jaResources, koResources } from '@nihongo/browser/i18n/resources/index'
import { expect, it, vi } from 'vitest'

it.each(['ko', 'ja'] as const)(
  'initializes saved %s before rendering and switches synchronously offline',
  async (locale) => {
    localStorage.setItem(
      'harumaru:ui-locale:v1',
      JSON.stringify({ version: 1, locale })
    )
    vi.resetModules()
    const { appI18n } = await import('@nihongo/browser/i18n/config')
    expect(appI18n.isInitialized).toBe(true)
    expect(appI18n.getDataByLanguage('ja')).toEqual(jaResources)
    expect(Object.keys(appI18n.getDataByLanguage('ja') ?? {})).toEqual(
      Object.keys(jaResources)
    )
    expect(appI18n.t('admin:name')).toBe(locale === 'ko' ? '관리자' : '管理者')
    expect(appI18n.resolvedLanguage).toBe(locale)
    expect(appI18n.t('actions.close')).toBe(locale === 'ko' ? '닫기' : '閉じる')
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('offline'))
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      const nextLocale = locale === 'ko' ? 'ja' : 'ko'
      const switched = appI18n.changeLanguage(nextLocale)
      expect(appI18n.resolvedLanguage).toBe(nextLocale)
      expect(appI18n.t('actions.close')).toBe(
        nextLocale === 'ko' ? '닫기' : '閉じる'
      )
      expect(appI18n.t('admin:name')).toBe(
        nextLocale === 'ko' ? '관리자' : '管理者'
      )
      await switched
      expect(fetch).not.toHaveBeenCalled()
      expect(appI18n.options.fallbackLng).toEqual(['ko'])
      expect(Object.keys(appI18n.getDataByLanguage('ko') ?? {})).toEqual(
        Object.keys(appI18n.getDataByLanguage('ja') ?? {})
      )
    } finally {
      fetch.mockRestore()
      online.mockRestore()
    }
  }
)

it('matches approved Japanese additions and preserves admin keys, values and order', () => {
  expect(Object.keys(jaResources)).toEqual(Object.keys(koResources))
  expect(
    createHash('sha256').update(JSON.stringify(koResources)).digest('hex')
  ).toBe('384e99e6b3e81db7c369cbe37b94932f266e95416ad91fb2622036c240c5727a')
  expect(
    createHash('sha256').update(JSON.stringify(jaResources)).digest('hex')
  ).toBe('cfe385c32d4fbe78c48aaa88fe65c73f0ec39a3e979f4445315eacf2852a87cb')
  expect(
    createHash('sha256').update(JSON.stringify(jaResources.admin)).digest('hex')
  ).toBe('ab72323ec53d4695a86ee87296c51e4784fbd66bb245f1c02184b251769c0347')
})

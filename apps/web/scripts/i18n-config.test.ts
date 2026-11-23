import { createHash } from 'node:crypto'
import {
  jaAdminLearnerResources,
  jaResources,
  koAdminLearnerResources,
  koResources
} from '@nihongo/browser/i18n/resources/index'
import { expect, it, vi } from 'vitest'

it.each(['ko', 'ja'] as const)(
  'initializes saved %s before rendering and switches synchronously offline',
  async (locale) => {
    localStorage.setItem(
      'harumaru:ui-locale:v1',
      JSON.stringify({ version: 1, locale })
    )
    vi.resetModules()
    const { appI18n, loadAdminResources } = await import(
      '@nihongo/browser/i18n/config'
    )
    expect(appI18n.isInitialized).toBe(true)
    // Startup carries only the admin copy the learner app shows (JLP-758).
    expect(appI18n.getDataByLanguage('ja')).toEqual({
      ...jaResources,
      admin: jaAdminLearnerResources
    })
    expect(appI18n.getDataByLanguage('ko')).toEqual({
      ...koResources,
      admin: koAdminLearnerResources
    })
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
    await loadAdminResources()
    expect(appI18n.getDataByLanguage('ja')).toEqual(jaResources)
    expect(appI18n.getDataByLanguage('ko')).toEqual(koResources)
  }
)

it('matches approved Japanese additions and preserves admin keys, values and order', () => {
  expect(Object.keys(jaResources)).toEqual(Object.keys(koResources))
  expect(
    createHash('sha256').update(JSON.stringify(koResources)).digest('hex')
  ).toBe('74f3968764e79d57810046fc6775359dcb689375ab3d04e9c7e47217ff7a485d')
  expect(
    createHash('sha256').update(JSON.stringify(jaResources)).digest('hex')
  ).toBe('fa233394cd7cd1777f6f63f302629b6ea97a7bf10e1765dc8ed1da94da5f0fde')
  expect(
    createHash('sha256').update(JSON.stringify(jaResources.admin)).digest('hex')
  ).toBe('2286dbcbe8accc6e7b9acf3f48088031669ad2cfc3e5cbc03b8426d019f60f62')
})

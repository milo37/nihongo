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
  ).toBe('dd07ee8000ac6627945429967fe6f8c2525ad5012563f5bfa94ffef83c001fc7')
  expect(
    createHash('sha256').update(JSON.stringify(jaResources)).digest('hex')
  ).toBe('0ea66f28af56b740dc9f290e41a04b75d8d25a0a3c33e1d816fb6a9faee25591')
  expect(
    createHash('sha256').update(JSON.stringify(jaResources.admin)).digest('hex')
  ).toBe('838e5bbcdb7fb6af13eaf3111e7d9997587a85fdeccbffc188bcd0a2b31b878a')
})

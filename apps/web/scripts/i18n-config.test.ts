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
  ).toBe('26502f3e2b7d94493797f44a73c5ec0c7ea43411343531782b1e9a5aee0582ea')
  expect(
    createHash('sha256').update(JSON.stringify(jaResources)).digest('hex')
  ).toBe('ed60dbc719378ed8ee8ee4316b44fd0b88fd86b72134edb1bd5632d2fa5f7356')
  expect(
    createHash('sha256').update(JSON.stringify(jaResources.admin)).digest('hex')
  ).toBe('42ac8e4ba122eb2463d932f32669430034e4dbd8b229f3ab59b5135c866a014e')
})

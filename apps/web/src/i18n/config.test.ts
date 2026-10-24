import { createHash } from 'node:crypto'
import { jaResources, koResources } from '@/i18n/resources'
import { expect, it, vi } from 'vitest'

it.each(['ko', 'ja'] as const)(
  'initializes saved %s before rendering and switches synchronously offline',
  async (locale) => {
    localStorage.setItem(
      'jlpt-drill-note:ui-locale:v1',
      JSON.stringify({ version: 1, locale })
    )
    vi.resetModules()
    const { appI18n } = await import('@/i18n/config')
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

it('preserves every Japanese catalog and admin key, value and order', () => {
  expect(Object.keys(jaResources)).toEqual(Object.keys(koResources))
  expect(
    createHash('sha256').update(JSON.stringify(jaResources)).digest('hex')
  ).toBe('60aa392c17e932e14e760a90922fd7bd8c1cab0d427200f2cc24aa4e03b0d9bb')
  expect(
    createHash('sha256').update(JSON.stringify(jaResources.admin)).digest('hex')
  ).toBe('d17b06416b7cd34d285cbe4f21b46d1cc10aa2c14ebaafc790d903c4e4233885')
})

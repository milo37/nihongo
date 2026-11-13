import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { Layout } from '@app/layout'
import { appI18n } from '@nihongo/browser/i18n/config'
import { UI_LOCALE_STORAGE_KEY } from '@nihongo/browser/libs/localeStorage'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'

// #975: production builds with the menu turned off.
vi.mock('@common/libs/languageMenu', () => ({ isLanguageMenuShown: false }))

vi.mock('@nihongo/browser/provider/ProtectedRouteProvider', () => ({
  useAuth: () => ({ isReady: true, role: 'GUEST', user: null })
}))

const savedJapanese = JSON.stringify({ locale: 'ja', version: 1 })

const renderLayout = (): ReturnType<typeof render> =>
  render(
    <I18nProvider fixedLocale="ko">
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    </I18nProvider>
  )

beforeEach(async () => {
  window.localStorage.clear()
  await appI18n.changeLanguage('ja')
})

it('hides the language menu and shows Korean to a browser that saved Japanese', () => {
  window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, savedJapanese)

  renderLayout()

  const banner = screen.getByRole('banner')
  expect(
    within(banner).queryByRole('button', { name: /언어|言語/u })
  ).toBeNull()
  expect(banner.querySelector('.locale-menu-trigger')).toBeNull()
  expect(appI18n.resolvedLanguage).toBe('ko')
  expect(document.documentElement.lang).toBe('ko')
  // The saved choice stays for when the menu comes back.
  expect(window.localStorage.getItem(UI_LOCALE_STORAGE_KEY)).toBe(savedJapanese)
})

it('stays Korean when another tab saves Japanese', () => {
  renderLayout()

  act(() => {
    window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, savedJapanese)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: UI_LOCALE_STORAGE_KEY,
        newValue: savedJapanese,
        storageArea: window.localStorage
      })
    )
  })

  expect(appI18n.resolvedLanguage).toBe('ko')
  expect(document.documentElement.lang).toBe('ko')
})

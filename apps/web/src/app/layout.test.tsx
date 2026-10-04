import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { Layout } from '@app/layout'
import { appI18n } from '@/i18n/config'
import { useAppStore } from '@store/index'

const mocks = vi.hoisted(() => ({ setLocale: vi.fn() }))
vi.mock('@provider/ProtectedRouteProvider', () => ({
  useAuth: () => ({ isReady: true, role: 'GUEST', user: null })
}))
vi.mock('@provider/I18nProvider', () => ({
  useUiLocale: () => ({
    locale: appI18n.resolvedLanguage,
    setLocale: mocks.setLocale
  })
}))
beforeEach(() => {
  useAppStore.setState({ isMobileMenuOpen: false })
  mocks.setLocale.mockClear()
})
afterEach(() => useAppStore.setState({ isMobileMenuOpen: false }))
it.each(['ko', 'ja'] as const)(
  'keeps brand, language control and Escape focus return available (%s)',
  async (locale) => {
    await appI18n.changeLanguage(locale)
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    )
    expect(
      screen.getByRole('link', { name: /JLPT Drill Note/ })
    ).toHaveAttribute('href', '/')
    const menu = screen.getByRole('button', {
      name: appI18n.t('navigation:menuOpen')
    })
    await userEvent.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    const language = screen.getByRole('combobox')
    await userEvent.selectOptions(language, locale === 'ko' ? 'ja' : 'ko')
    expect(mocks.setLocale).toHaveBeenCalledWith(locale === 'ko' ? 'ja' : 'ko')
    await userEvent.keyboard('{Escape}')
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(menu).toHaveFocus()
  }
)

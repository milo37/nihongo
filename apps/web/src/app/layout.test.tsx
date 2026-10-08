import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { Layout } from '@app/layout'
import { appI18n } from '@/i18n/config'
import { useAppStore } from '@store/index'

const mocks = vi.hoisted(() => ({
  setLocale: vi.fn(),
  role: 'GUEST' as 'GUEST' | 'USER' | 'ADMIN'
}))
vi.mock('@provider/ProtectedRouteProvider', () => ({
  useAuth: () => ({ isReady: true, role: mocks.role, user: null })
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
  mocks.role = 'GUEST'
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
    const nav = screen.getByRole('navigation', {
      name: appI18n.t('navigation:primary')
    })
    const learningStart = within(nav).getByRole('link', {
      name: appI18n.t('navigation:learningStart')
    })
    expect(learningStart).toHaveAttribute('href', '/')
    expect(learningStart).toHaveAttribute('aria-current', 'page')
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(
      within(nav).getByRole('link', { name: appI18n.t('navigation:practice') })
    ).toHaveAttribute('href', '/practice')
    const language = screen.getByRole('combobox')
    await userEvent.selectOptions(language, locale === 'ko' ? 'ja' : 'ko')
    expect(mocks.setLocale).toHaveBeenCalledWith(locale === 'ko' ? 'ja' : 'ko')
    await userEvent.keyboard('{Escape}')
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(menu).toHaveFocus()
  }
)

it.each(['ko', 'ja'] as const)(
  'keeps the seven information destinations in policy/account/support order (%s)',
  async (locale) => {
    await appI18n.changeLanguage(locale)
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Layout />
      </MemoryRouter>
    )
    const footer = screen.getByRole('contentinfo')
    const nav = within(footer).getByRole('navigation', {
      name: appI18n.t('common:footer.informationLabel')
    })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
    ).toEqual([
      '/legal#terms',
      '/legal#privacy',
      '/legal#copyright',
      '/account/data#deletion',
      '/account/data#data-export',
      '/support#question-report',
      '/support#contact'
    ])
    expect(
      within(footer).getByText(appI18n.t('common:footer.originalContent'), {
        exact: false
      })
    ).toHaveTextContent(appI18n.t('common:footer.scope'))
    expect(
      screen.getByRole('main').compareDocumentPosition(footer) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  }
)

it.each(['ko', 'ja'] as const)(
  'marks only the current member learning entry in the existing navigation (%s)',
  async (locale) => {
    await appI18n.changeLanguage(locale)
    mocks.role = 'USER'
    render(
      <MemoryRouter initialEntries={['/dashboard?view=learning']}>
        <Layout />
      </MemoryRouter>
    )
    await userEvent.click(
      screen.getByRole('button', { name: appI18n.t('navigation:menuOpen') })
    )
    const nav = screen.getByRole('navigation', {
      name: appI18n.t('navigation:primary')
    })
    const learningStart = within(nav).getByRole('link', {
      name: appI18n.t('navigation:learningStart')
    })
    expect(learningStart).toHaveAttribute('href', '/dashboard?view=learning')
    expect(learningStart).toHaveAttribute('aria-current', 'page')
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(
      within(nav).getByRole('link', { name: appI18n.t('navigation:dashboard') })
    ).not.toHaveAttribute('aria-current', 'page')
  }
)

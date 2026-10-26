import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { Layout } from '@app/layout'
import { appI18n } from '@nihongo/browser/i18n/config'
import { useAppStore } from '@nihongo/browser/store/index'

const mocks = vi.hoisted(() => ({
  setLocale: vi.fn(),
  role: 'GUEST' as 'GUEST' | 'USER' | 'ADMIN',
  review: false
}))
vi.mock('@nihongo/browser/provider/ProtectedRouteProvider', () => ({
  useAuth: () => ({ isReady: true, role: mocks.role, user: null })
}))
vi.mock('@app/wrong-note/reviewReturnContext', () => ({
  readReviewReturnContext: () =>
    mocks.review ? { questionId: 'question', returnTo: '/wrong-notes' } : null
}))
vi.mock('@nihongo/browser/provider/I18nProvider', () => ({
  useUiLocale: () => ({
    locale: appI18n.resolvedLanguage,
    setLocale: mocks.setLocale
  })
}))
beforeEach(() => {
  useAppStore.setState({ isMobileMenuOpen: false })
  mocks.setLocale.mockClear()
  mocks.role = 'GUEST'
  mocks.review = false
})
afterEach(() => useAppStore.setState({ isMobileMenuOpen: false }))

it.each(['ko', 'ja'] as const)(
  'keeps approved brand, three destinations and account locale/Escape (%s)',
  async (locale) => {
    await appI18n.changeLanguage(locale)
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    )
    expect(
      within(screen.getByRole('banner')).getByRole('link', {
        name: appI18n.t('common:appName')
      })
    ).toHaveAttribute('href', '/')
    const primary = screen.getByRole('navigation', {
      name: appI18n.t('navigation:primary')
    })
    expect(
      within(primary)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href'))
    ).toEqual(['/practice', '/wrong-notes', '/bookmarks'])
    expect(
      within(primary).getByRole('link', {
        name: appI18n.t('navigation:learningStart')
      })
    ).toHaveAttribute('aria-current', 'page')
    expect(primary.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    const account = screen.getByRole('button', {
      name: appI18n.t('navigation:account')
    })
    await userEvent.click(account)
    expect(account).toHaveAttribute('aria-expanded', 'true')
    const accountNav = screen.getByRole('navigation', {
      name: appI18n.t('navigation:account')
    })
    expect(
      within(accountNav).getByRole('link', {
        name: appI18n.t('navigation:login')
      })
    ).toHaveAttribute('href', '/login')
    await userEvent.selectOptions(
      within(accountNav).getByRole('combobox'),
      locale === 'ko' ? 'ja' : 'ko'
    )
    expect(mocks.setLocale).toHaveBeenCalledWith(locale === 'ko' ? 'ja' : 'ko')
    await userEvent.keyboard('{Escape}')
    expect(account).toHaveAttribute('aria-expanded', 'false')
    expect(account).toHaveFocus()
  }
)

it.each(['ko', 'ja'] as const)(
  'keeps three information entry destinations in document flow (%s)',
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
        .map((a) => a.getAttribute('href'))
    ).toEqual(['/legal', '/support', '/account/data'])
    expect(
      screen.getByRole('main').compareDocumentPosition(footer) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  }
)

it.each(['ko', 'ja'] as const)(
  'shares active learning context for member entry and preserves admin access (%s)',
  async (locale) => {
    await appI18n.changeLanguage(locale)
    mocks.role = 'ADMIN'
    render(
      <MemoryRouter initialEntries={['/dashboard?view=learning']}>
        <Layout />
      </MemoryRouter>
    )
    for (const label of ['primary', 'mobilePrimary'] as const) {
      const nav = screen.getByRole('navigation', {
        name: appI18n.t(`navigation:${label}`)
      })
      expect(
        within(nav).getByRole('link', {
          name: appI18n.t('navigation:learningStart')
        })
      ).toHaveAttribute('aria-current', 'page')
      expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    }
    await userEvent.click(
      screen.getByRole('button', { name: appI18n.t('navigation:account') })
    )
    const account = screen.getByRole('navigation', {
      name: appI18n.t('navigation:account')
    })
    expect(
      within(account).getByRole('link', {
        name: appI18n.t('navigation:learningStart')
      })
    ).toHaveAttribute('href', '/dashboard?view=learning')
    expect(
      within(account).getByRole('link', {
        name: appI18n.t('navigation:adminQuestions')
      })
    ).toHaveAttribute('href', window.location.origin + '/admin/questions')
  }
)

it('leaves ordinary sessions with page-owned focus header and main skip target', () => {
  render(
    <MemoryRouter initialEntries={['/practice/session/session']}>
      <Layout />
    </MemoryRouter>
  )
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: appI18n.t('navigation:skipToContent') })
  ).toHaveAttribute('href', '#main-content')
  expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1')
})

it('keeps review session/result navigation in review context', () => {
  mocks.review = true
  render(
    <MemoryRouter initialEntries={['/practice/result/session']}>
      <Layout />
    </MemoryRouter>
  )
  const nav = screen.getByRole('navigation', {
    name: appI18n.t('navigation:primary')
  })
  expect(
    within(nav).getByRole('link', { name: appI18n.t('navigation:wrongNotes') })
  ).toHaveAttribute('aria-current', 'page')
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  expect(document.title).toContain(appI18n.t('common:appName'))
})

it('composes desktop navigation outside the utility header without duplicating destination IDs', () => {
  render(
    <MemoryRouter initialEntries={['/bookmarks']}>
      <Layout />
    </MemoryRouter>
  )
  const sidebar = screen.getByRole('navigation', {
    name: appI18n.t('navigation:primary')
  })
  expect(sidebar.closest('.app-side-navigation')).not.toBeNull()
  expect(screen.getByRole('banner').contains(sidebar)).toBe(false)
  expect(
    within(screen.getByRole('banner')).queryByRole('link', {
      name: appI18n.t('navigation:learningStart')
    })
  ).not.toBeInTheDocument()
  expect(document.querySelectorAll('#primary-navigation')).toHaveLength(1)
  expect(document.querySelectorAll('#mobile-navigation')).toHaveLength(1)
  expect(
    within(sidebar).getByRole('link', {
      name: appI18n.t('navigation:bookmarks')
    })
  ).toHaveAttribute('aria-current', 'page')
})
it('keeps an ordinary result in learning context rather than switching it to review', () => {
  render(
    <MemoryRouter initialEntries={['/practice/result/session']}>
      <Layout />
    </MemoryRouter>
  )
  const sidebar = screen.getByRole('navigation', {
    name: appI18n.t('navigation:primary')
  })
  expect(
    within(sidebar).getByRole('link', {
      name: appI18n.t('navigation:learningStart')
    })
  ).toHaveAttribute('aria-current', 'page')
})

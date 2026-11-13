import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { Layout } from '@app/layout'
import { AppLayout } from '@nihongo/browser/common/components/AppLayout'
import { appI18n } from '@nihongo/browser/i18n/config'
import { useAppStore } from '@nihongo/browser/store/index'

const mocks = vi.hoisted(() => ({
  setLocale: vi.fn(),
  role: 'GUEST' as 'GUEST' | 'USER' | 'ADMIN',
  user: null as { id: string; name: string; role: 'USER' | 'ADMIN' } | null,
  review: false
}))
vi.mock('@nihongo/browser/provider/ProtectedRouteProvider', () => ({
  useAuth: () => ({ isReady: true, role: mocks.role, user: mocks.user })
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
  mocks.user = null
  mocks.review = false
})
afterEach(() => useAppStore.setState({ isMobileMenuOpen: false }))

it.each(['ko', 'ja'] as const)(
  'keeps approved brand, four destinations, language button and account Escape (%s)',
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
    const primary = topNavigation()
    expect(
      within(primary)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href'))
    ).toEqual(['/', '/wrong-notes', '/bookmarks', '/account'])
    expect(
      within(primary).getByRole('link', { name: appI18n.t('navigation:my') })
    ).toBeInTheDocument()
    expect(
      within(primary).getByRole('link', {
        name: appI18n.t('navigation:learningStart')
      })
    ).toHaveAttribute('aria-current', 'page')
    expect(primary.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(
      within(screen.getByRole('banner')).queryByRole('combobox')
    ).not.toBeInTheDocument()
    // A guest sees a [로그인] text button that opens the same menu.
    const account = screen.getByRole('button', {
      name: appI18n.t('navigation:login')
    })
    expect(account).toHaveTextContent(appI18n.t('navigation:login'))
    expect(account).toHaveAttribute('aria-haspopup', 'menu')
    await userEvent.click(account)
    expect(account).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu')
    const login = within(menu).getByRole('menuitem', {
      name: appI18n.t('navigation:login')
    })
    expect(login).toHaveAttribute('href', '/login')
    expect(menu).toHaveFocus()
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1)
    // Language moved out of the account menu to its own top bar button.
    expect(within(menu).queryByRole('menuitemradio')).not.toBeInTheDocument()
    expect(menu.querySelector('[role="separator"]')).toBeNull()
    expect(
      within(screen.getByRole('banner')).getByRole('button', {
        name: appI18n.t('common:locale.change')
      })
    ).toHaveAttribute('aria-haspopup', 'menu')
    await userEvent.keyboard('{Escape}')
    expect(account).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(account).toHaveFocus()
  }
)

// The information links moved to the bottom of 마이 (direction §1-1).
// The top bar and the bottom tabs share one name; CSS shows one at a time.
const topNavigation = (): HTMLElement =>
  screen
    .getAllByRole('navigation', { name: appI18n.t('navigation:primary') })
    .find((nav) => nav.id === 'primary-navigation') as HTMLElement

it('renders no shell footer for learners', () => {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Layout />
    </MemoryRouter>
  )
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
})

it.each(['ko', 'ja'] as const)(
  'shares active learning context for member entry and preserves admin access (%s)',
  async (locale) => {
    await appI18n.changeLanguage(locale)
    mocks.role = 'ADMIN'
    mocks.user = { id: 'admin-1', name: '하루 관리자', role: 'ADMIN' }
    render(
      <MemoryRouter initialEntries={['/dashboard?view=learning']}>
        <Layout />
      </MemoryRouter>
    )
    for (const id of ['primary-navigation', 'mobile-navigation']) {
      const nav = document.getElementById(id) as HTMLElement
      expect(
        within(nav).getByRole('link', {
          name: appI18n.t('navigation:learningStart')
        })
      ).toHaveAttribute('aria-current', 'page')
      expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    }
    const account = screen.getByRole('button', {
      name: appI18n.t('navigation:accountMenu.label')
    })
    expect(account).toHaveTextContent('하루')
    await userEvent.click(account)
    const menu = screen.getByRole('menu')
    // JLP-849: a click focuses the menu box; only the keyboard opens on an item.
    expect(menu).toHaveFocus()
    expect(menu).toHaveClass('gap-1')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual([
      appI18n.t('navigation:accountMenu.myPage'),
      appI18n.t('admin:questionReportDialog.appErrorTrigger'),
      appI18n.t('auth:sso.logoutAction')
    ])
    expect(
      within(menu).getByRole('menuitem', {
        name: appI18n.t('navigation:accountMenu.myPage')
      })
    ).toHaveAttribute('href', '/account')
    expect(
      within(menu).queryByRole('link', {
        name: appI18n.t('navigation:routes.adminQuestions')
      })
    ).not.toBeInTheDocument()
    await userEvent.keyboard('{End}')
    expect(
      within(menu).getByRole('menuitem', {
        name: appI18n.t('auth:sso.logoutAction')
      })
    ).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(
      within(menu).getByRole('menuitem', {
        name: appI18n.t('navigation:accountMenu.myPage')
      })
    ).toHaveFocus()
    await userEvent.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    account.focus()
    await userEvent.keyboard('{Enter}')
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: appI18n.t('navigation:accountMenu.myPage')
      })
    ).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(account)
    await userEvent.keyboard('{ArrowUp}')
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: appI18n.t('auth:sso.logoutAction')
      })
    ).toHaveFocus()
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

it('hides the bottom tabs in a wrong-note retry session (JLP-854)', () => {
  mocks.review = true
  render(
    <MemoryRouter initialEntries={['/practice/session/session']}>
      <Layout />
    </MemoryRouter>
  )
  // The tabs would cover the fixed submit bar under 1024px.
  expect(document.querySelector('#mobile-navigation')).toBeNull()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})

it('keeps review session/result navigation in review context', () => {
  mocks.review = true
  render(
    <MemoryRouter initialEntries={['/practice/result/session']}>
      <Layout />
    </MemoryRouter>
  )
  const nav = topNavigation()
  expect(
    within(nav).getByRole('link', { name: appI18n.t('navigation:wrongNotes') })
  ).toHaveAttribute('aria-current', 'page')
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  expect(document.title).toContain(appI18n.t('common:appName'))
})

it('puts the desktop links in the top bar without duplicating destination IDs', () => {
  render(
    <MemoryRouter initialEntries={['/bookmarks']}>
      <Layout />
    </MemoryRouter>
  )
  const sidebar = topNavigation()
  expect(screen.getByRole('banner').contains(sidebar)).toBe(true)
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
  const sidebar = topNavigation()
  expect(
    within(sidebar).getByRole('link', {
      name: appI18n.t('navigation:learningStart')
    })
  ).toHaveAttribute('aria-current', 'page')
})
it.each([
  ['ko', '홈'],
  ['ja', 'ホーム']
] as const)(
  'names the first tab home, links it to / and keeps it lit on the practice setup (JLP-873, %s)',
  async (locale, label) => {
    await appI18n.changeLanguage(locale)
    render(
      <MemoryRouter initialEntries={['/practice']}>
        <Layout />
      </MemoryRouter>
    )
    for (const id of ['primary-navigation', 'mobile-navigation']) {
      const home = within(document.getElementById(id) as HTMLElement).getByRole(
        'link',
        { name: label }
      )
      expect(home).toHaveAttribute('href', '/')
      expect(home).toHaveAttribute('aria-current', 'page')
    }
  }
)
it('places an app-owned header status in the top bar just before the account menu', () => {
  render(
    <MemoryRouter initialEntries={['/practice']}>
      <AppLayout
        robots="noindex,follow"
        reviewReturnContext={null}
        accountMenu={<button type="button">계정</button>}
        headerStatus={<span>● 28분 남음</span>}
      />
    </MemoryRouter>
  )
  const banner = screen.getByRole('banner')
  const status = within(banner).getByText('● 28분 남음')
  const account = within(banner).getByRole('button', { name: '계정' })
  expect(
    status.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(status.closest('.app-shell-header-status')).not.toBeNull()
})
it('adds no header status wrapper when the app has none', () => {
  render(
    <MemoryRouter initialEntries={['/practice']}>
      <AppLayout
        robots="noindex,follow"
        reviewReturnContext={null}
        accountMenu={<span>계정</span>}
      />
    </MemoryRouter>
  )
  expect(document.querySelector('.app-shell-header-status')).toBeNull()
})

// JLP-850: the account data guide is one of the three information pages,
// so the bottom tab 'My' lights only on My itself.
it.each([
  ['/account', true],
  ['/account/data', false],
  ['/legal', false]
])('lights the My tab on %s: %s', (path, active) => {
  mocks.role = 'USER'
  mocks.user = { id: 'user-1', name: '하루', role: 'USER' }
  render(
    <MemoryRouter initialEntries={[path]}>
      <Layout />
    </MemoryRouter>
  )
  const my = within(
    document.getElementById('mobile-navigation') as HTMLElement
  ).getByRole('link', { name: appI18n.t('navigation:my') })
  if (active) expect(my).toHaveAttribute('aria-current', 'page')
  else expect(my).not.toHaveAttribute('aria-current')
})

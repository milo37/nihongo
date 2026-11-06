import { QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
import { appRoutes } from '@/router'
import { operationsRoutes } from '@app/operations/router'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import type { LegalSettings } from '@app/operations/legalSettings'
import { OperationsInformationPage } from '@app/operations/page'

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn()
  })
})
afterEach(() => {
  cleanup()
  if (originalScrollIntoView)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView
    })
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

const renderInformationRoute = (entry: string) => {
  const router = createMemoryRouter(appRoutes, { initialEntries: [entry] })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
  return { router, ...view }
}

const cases = [
  {
    path: '/legal',
    title: '이용 안내',
    jaTitle: '利用案内',
    ids: ['terms', 'privacy', 'copyright']
  },
  {
    path: '/support',
    title: '문제 신고·문의 안내',
    jaTitle: '問題報告・お問い合わせの案内',
    ids: ['question-report', 'contact']
  }
] as const

it.each(cases)(
  'opens public $path with named contents and fragment focus in the actual app shell',
  async ({ path, title, ids }) => {
    const { router, container } = renderInformationRoute(path + '#' + ids[0])
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: title
    })
    const page = heading.closest('.operations-information') as HTMLElement
    expect(router.state.location.pathname).toBe(path)
    const navigation = within(page).getByRole('navigation', {
      name: '서비스 안내'
    })
    const current = navigation.querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAttribute('href', path)
    const toc = within(page).getByRole('navigation', { name: '이 페이지 목차' })
    const links = within(toc).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      ids.map((id) => path + '#' + id)
    )
    for (const [index, id] of ids.entries()) {
      const target = document.getElementById(id)!
      expect(target).toHaveAttribute('tabindex', '-1')
      expect(target).toHaveAttribute('aria-labelledby', id + '-title')
      expect(
        within(target).getByRole('heading', { level: 2 }).textContent
      ).toBe(links[index]?.textContent)
    }
    await waitFor(() => expect(document.getElementById(ids[0])).toHaveFocus())
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: 'start'
    })
    expect(page).not.toHaveTextContent('확인이 필요합니다')
    expect(container.querySelector('form')).toBeNull()
    expect(
      page.querySelector('button,input,[download],a[href^="mailto:"]')
    ).toBeNull()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  }
)

it.each(['USER', 'ADMIN'] as const)(
  'keeps both information routes public for %s without changing account or admin guards',
  async (role) => {
    mockDatabase.loginAs(role)
    const { router } = renderInformationRoute('/legal')
    await screen.findByRole('heading', { level: 1, name: '이용 안내' })
    await act(async () => {
      await router.navigate('/support')
    })
    await screen.findByRole('heading', {
      level: 1,
      name: '문제 신고·문의 안내'
    })
    expect(router.state.location.pathname).toBe('/support')
  }
)

it('connects footer, contents focus, cross-page navigation and Back; registers account/data only once', async () => {
  const user = userEvent.setup()
  const { router } = renderInformationRoute('/')
  const footer = await screen.findByRole('contentinfo')
  await user.click(within(footer).getByRole('link', { name: '이용 안내' }))
  await screen.findByRole('heading', { level: 1, name: '이용 안내' })
  const toc = screen.getByRole('navigation', { name: '이 페이지 목차' })
  const privacy = within(toc).getByRole('link', { name: '개인정보 처리방침' })
  privacy.focus()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(document.getElementById('privacy')).toHaveFocus())
  expect(router.state.location.hash).toBe('#privacy')
  const nav = screen.getByRole('navigation', { name: '서비스 안내' })
  expect(
    within(nav).getByRole('link', { name: '계정·데이터' })
  ).toHaveAttribute('href', '/account/data')
  await user.click(within(nav).getByRole('link', { name: '신고·문의' }))
  await screen.findByRole('heading', { level: 1, name: '문제 신고·문의 안내' })
  await act(async () => {
    await router.navigate(-1)
  })
  await screen.findByRole('heading', { level: 1, name: '이용 안내' })
  expect(router.state.location.hash).toBe('#privacy')
  await waitFor(() => expect(document.getElementById('privacy')).toHaveFocus())
  expect(operationsRoutes.map((route) => route.path)).toEqual([
    'legal',
    'support'
  ])
  const accountPaths = appRoutes
    .find((route) => route.path === '/')
    ?.children?.filter((route) => route.path === 'account/data')
  expect(accountPaths).toHaveLength(1)
})

it.each([
  {
    path: '/legal',
    id: 'privacy',
    title: '이용 안내',
    linkName: '개인정보 처리방침'
  },
  {
    path: '/support',
    id: 'contact',
    title: '문제 신고·문의 안내',
    linkName: '문의'
  }
])(
  'refocuses and scrolls $path on repeated same-hash keyboard and mouse activation',
  async ({ path, id, title, linkName }) => {
    const user = userEvent.setup()
    const { router } = renderInformationRoute(path + '#' + id)
    await screen.findByRole('heading', { level: 1, name: title })
    const target = document.getElementById(id)!
    await waitFor(() => expect(target).toHaveFocus())
    const toc = screen.getByRole('navigation', { name: '이 페이지 목차' })
    const link = within(toc).getByRole('link', { name: linkName })
    const initialLocation = router.state.location

    for (const activation of ['keyboard', 'mouse', 'keyboard', 'mouse']) {
      link.focus()
      expect(link).toHaveFocus()
      vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear()
      if (activation === 'keyboard') await user.keyboard('{Enter}')
      else await user.click(link)
      expect(target).toHaveFocus()
      expect(
        HTMLElement.prototype.scrollIntoView
      ).toHaveBeenCalledExactlyOnceWith({
        block: 'start'
      })
      expect(router.state.location).toEqual(initialLocation)
    }
  }
)

it('explains reporting and an unset contact email without inventing a form, email or success', async () => {
  const { container } = renderInformationRoute('/support')
  await screen.findByRole('heading', { level: 1, name: '문제 신고·문의 안내' })
  expect(screen.getByText(/6개 사유 중 하나/)).toHaveTextContent(
    '설명은 필수이며 최대 2,000자입니다.'
  )
  expect(
    screen.getByText(/신고마다 개별 답변을 보내지는 않습니다/)
  ).toBeInTheDocument()
  expect(
    screen.getByText('문의 이메일은 정식 공개 때 안내합니다.')
  ).toBeInTheDocument()
  expect(container).not.toHaveTextContent('확인이 필요합니다')
  expect(
    container.querySelector('form,a[href^="mailto:"],[download]')
  ).toBeNull()
})

const renderLegalPage = (page: 'legal' | 'support', settings: LegalSettings) =>
  render(
    <I18nProvider>
      <MemoryRouter>
        <OperationsInformationPage page={page} settings={settings} />
      </MemoryRouter>
    </I18nProvider>
  )

it('fills the effective date, privacy officer and contact email from the settings', () => {
  renderLegalPage('legal', {
    effectiveDate: '2026-11-16',
    contactEmail: 'help@example.com',
    privacyOfficer: '홍길동'
  })
  expect(screen.getByText('시행일: 2026-11-16')).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { level: 3, name: '제12조(부칙)' })
  ).toBeInTheDocument()
  expect(
    screen.getByText('이 약관은 2026-11-16부터 시행합니다.')
  ).toBeInTheDocument()
  expect(
    screen.getByText('개인정보 보호책임자: 홍길동 / 연락처: help@example.com')
  ).toBeInTheDocument()
  expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(27)
  cleanup()
  renderLegalPage('support', {
    effectiveDate: '2026-11-16',
    contactEmail: 'help@example.com',
    privacyOfficer: '홍길동'
  })
  expect(
    screen.getByText(
      '계정, 개인정보, 저작권에 관한 문의는 이메일로 받습니다: help@example.com'
    )
  ).toBeInTheDocument()
  expect(
    screen.queryByText('문의 이메일은 정식 공개 때 안내합니다.')
  ).not.toBeInTheDocument()
})

it('shows the fallback copy for empty settings', () => {
  renderLegalPage('legal', {
    effectiveDate: '',
    contactEmail: '',
    privacyOfficer: ''
  })
  expect(screen.getByText('시행일: 정식 공개일')).toBeInTheDocument()
  expect(
    screen.getByText(
      '개인정보 보호책임자: 하루마루 운영자 / 연락처: 문의 이메일은 정식 공개 때 안내합니다.'
    )
  ).toBeInTheDocument()
  // Each circled clause gets its own paragraph.
  expect(
    screen.getByText('① "회원"은 Google 계정으로 로그인한 이용자입니다.')
  ).toBeInTheDocument()
})

it.each(cases)(
  'localizes $path and its own contents in Japanese at the same URL',
  async ({ path, jaTitle, ids }) => {
    expect(writeUiLocalePreference('ja')).toBe(true)
    const { router } = renderInformationRoute(path + '#' + ids[0])
    await screen.findByRole('heading', { level: 1, name: jaTitle })
    expect(
      screen.getByRole('navigation', { name: 'サービス案内' })
    ).toBeInTheDocument()
    const toc = screen.getByRole('navigation', { name: 'このページの目次' })
    expect(
      within(toc)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'))
    ).toEqual(ids.map((id) => path + '#' + id))
    expect(router.state.location.pathname).toBe(path)
    expect(router.state.location.hash).toBe('#' + ids[0])
  }
)

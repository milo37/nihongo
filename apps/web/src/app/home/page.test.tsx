import {
  act,
  fireEvent,
  render as baseRender,
  screen,
  within
} from '@testing-library/react'
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes
} from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'
import type { ReactElement } from 'react'
const render = (ui: ReactElement) =>
  baseRender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>
  )
import { appI18n } from '@/i18n/config'
import { HomePage } from '@app/home/page'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  mockMode: true,
  mutate: vi.fn(),
  pending: false,
  failed: false
}))
vi.mock('@provider/ProtectedRouteProvider', () => ({ useAuth: mocks.auth }))
vi.mock('@app/practice/hooks/useCreateStudySession', () => ({
  useCreateStudySession: () => ({
    isPending: mocks.pending,
    isPaused: false,
    isError: mocks.failed,
    error: new Error('request failed'),
    mutate: mocks.mutate,
    reset: vi.fn()
  })
}))
vi.mock('@libs/apiMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@libs/apiMode')>()),
  get isMockApiMode() {
    return mocks.mockMode
  }
}))
beforeEach(async () => {
  await appI18n.changeLanguage('ko')
  mocks.pending = false
  mocks.failed = false
  mocks.mutate.mockClear()
  mocks.mockMode = true
  mocks.auth.mockReturnValue({
    isReady: true,
    role: 'USER',
    user: { id: 'member' }
  })
})

it('opens the member learning page through the existing protected dashboard route', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/dashboard" element={<h1>학습 노트 진입</h1>} />
      </Routes>
    </MemoryRouter>
  )
  expect(
    await screen.findByRole('heading', { name: '학습 노트 진입' })
  ).toBeVisible()
})

it.each([
  '?level=N5&subject=READING&count=20&mode=RANDOM&resumePage=3',
  '?level=N1&subject=GRAMMAR&count=10&mode=WRONG_NOTE&view=insights&view=invalid'
])(
  'preserves learning conditions and replaces the home history entry (%s)',
  async (search) => {
    const router = createMemoryRouter(
      [
        { path: '/', element: <HomePage /> },
        { path: '/dashboard', element: <h1>Member learning</h1> },
        { path: '/previous', element: <h1>Previous page</h1> }
      ],
      { initialEntries: ['/previous', `/${search}#learning`], initialIndex: 1 }
    )
    const view = render(<RouterProvider router={router} />)
    await screen.findByRole('heading', { name: 'Member learning' })
    expect(router.state.location.pathname).toBe('/dashboard')
    expect(router.state.location.hash).toBe('#learning')
    const expected = new URLSearchParams(search)
    expected.set('view', 'learning')
    expect(new URLSearchParams(router.state.location.search).toString()).toBe(
      expected.toString()
    )
    expect(
      new URLSearchParams(router.state.location.search).getAll('view')
    ).toEqual(['learning'])
    await act(async () => {
      await router.navigate(-1)
    })
    expect(router.state.location.pathname).toBe('/previous')
    view.unmount()
    router.dispose()
  }
)

it('retains guest filters at the home entry without a member redirect', async () => {
  mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
  const search = '?level=N5&subject=READING&count=20&mode=RANDOM'
  const router = createMemoryRouter([{ path: '/', element: <HomePage /> }], {
    initialEntries: [`/${search}`]
  })
  const view = render(<RouterProvider router={router} />)
  expect(await screen.findByRole('radio', { name: 'N5' })).toBeChecked()
  expect(screen.getByRole('radio', { name: '독해' })).toBeChecked()
  expect(router.state.location.pathname).toBe('/')
  expect(router.state.location.search).toBe(search)
  view.unmount()
  router.dispose()
})

it('keeps guest start available while disclosing example data', () => {
  mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>
  )
  expect(
    screen.getByRole('radio', {
      name: appI18n.t('practice:setup.questionCount', { formattedCount: 20 })
    })
  ).toBeVisible()
  expect(
    screen.getByRole('button', {
      name: appI18n.t('home:quickDrill.start', {
        level: 'N3',
        subject: appI18n.t('common:taxonomy.subjects.GRAMMAR'),
        formattedCount: 10
      })
    })
  ).toBeEnabled()
})

it('discloses example data in Japanese without obsolete verification claims', async () => {
  await appI18n.changeLanguage('ja')
  mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>
  )
  expect(screen.getByRole('form')).toBeVisible()
  expect(screen.queryByText(/独立検証中/)).not.toBeInTheDocument()
  client.clear()
})
it.each(['ko', 'ja'] as const)(
  'hides development notice and demo login in real mode (%s)',
  async (locale) => {
    await appI18n.changeLanguage(locale)
    mocks.mockMode = false
    mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>
    )
    expect(
      screen.queryByText(/개발용 예시 데이터|開発用のサンプルデータ/)
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /데모 계정|デモアカウント/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name:
          locale === 'ko' ? 'N3 문법 · 10문제 시작' : 'N3 文法 · 10問を始める'
      })
    ).toBeEnabled()
    client.clear()
  }
)

it.each(['ko', 'ja'] as const)(
  'submits one continuous form with the selected scope (%s)',
  async (locale) => {
    await appI18n.changeLanguage(locale)
    mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
    mocks.mutate.mockClear()
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )
    const form = screen.getByRole('form')
    expect(form.querySelectorAll('fieldset')).toHaveLength(3)
    const n5 = within(form).getByRole('radio', { name: 'N5' })
    fireEvent.click(n5)
    expect(n5).toBeChecked()
    expect(within(form).getByRole('radio', { name: 'N3' })).not.toBeChecked()
    const subject = within(form)
      .getAllByRole('radio')
      .find((button) =>
        button
          .closest('label')
          ?.textContent?.includes(locale === 'ko' ? '독해' : '読解')
      )
    expect(subject).toBeDefined()
    fireEvent.click(subject!)
    expect(subject).toBeChecked()
    expect(n5).toBeChecked()
    fireEvent.submit(form)
    expect(mocks.mutate).toHaveBeenCalledTimes(1)
    expect(mocks.mutate).toHaveBeenCalledWith(
      { level: 'N5', subject: 'READING', count: 10, mode: 'RANDOM' },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
  }
)

it('keeps the chosen level while a request has failed and allows retry', () => {
  mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
  mocks.failed = true
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  )
  fireEvent.click(screen.getByRole('radio', { name: 'N5' }))
  fireEvent.submit(screen.getByRole('form'))
  expect(screen.getByRole('alert')).toBeVisible()
  expect(screen.getByRole('radio', { name: 'N5' })).toBeChecked()
  fireEvent.submit(screen.getByRole('form'))
  expect(mocks.mutate).toHaveBeenCalledTimes(2)
})
it('announces loading and prevents duplicate start requests', () => {
  mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
  mocks.pending = true
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  )
  const submit = screen.getByRole('button')
  expect(submit).toBeDisabled()
  expect(submit).toHaveAttribute('aria-busy', 'true')
  expect(submit).toHaveAccessibleName(appI18n.t('home:approved.loading'))
  expect(submit.querySelector('svg')).toBeNull()
  expect(
    screen
      .getAllByRole('radio')
      .every(
        (radio) =>
          radio.hasAttribute('disabled') || radio.closest('fieldset')?.disabled
      )
  ).toBe(true)
  fireEvent.submit(screen.getByRole('form'))
  expect(mocks.mutate).not.toHaveBeenCalled()
})

it.each([
  ['ko', 'N5', 'VOCABULARY', '어휘', 'N5 어휘 · 10문제 시작'],
  ['ko', 'N3', 'GRAMMAR', '문법', 'N3 문법 · 10문제 시작'],
  ['ko', 'N1', 'READING', '독해', 'N1 독해 · 10문제 시작'],
  ['ja', 'N5', 'VOCABULARY', '語彙', 'N5 語彙 · 10問を始める'],
  ['ja', 'N3', 'GRAMMAR', '文法', 'N3 文法 · 10問を始める'],
  ['ja', 'N1', 'READING', '読解', 'N1 読解 · 10問を始める']
] as const)(
  'shows and submits the same current scope without a CTA icon (%s %s %s)',
  async (locale, level, subject, subjectLabel, label) => {
    await appI18n.changeLanguage(locale)
    mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByRole('radio', { name: level }))
    fireEvent.click(screen.getByRole('radio', { name: subjectLabel }))
    const start = screen.getByRole('button', { name: label })
    expect(start).toHaveTextContent(label)
    expect(start).toHaveAttribute('aria-label', label)
    expect(start.querySelector('svg')).toBeNull()
    expect(screen.getByRole('radio', { name: level })).toBeChecked()
    fireEvent.click(start)
    expect(mocks.mutate).toHaveBeenCalledWith(
      { level, subject, count: 10, mode: 'RANDOM' },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
  }
)

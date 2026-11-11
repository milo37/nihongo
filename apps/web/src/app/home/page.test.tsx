import {
  act,
  fireEvent,
  render as baseRender,
  screen,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LAST_PRACTICE_CHOICE_KEY } from '@app/practice/lastPracticeChoice'
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes
} from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getResponse, http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import type { ReactElement } from 'react'
const render = (ui: ReactElement) =>
  baseRender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  )
import { appI18n } from '@nihongo/browser/i18n/config'
import { HomePage, LearningHome } from '@app/home/page'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { dailyQuestionHandlers } from '@/mocks/handlers/dailyQuestionHandlers'
import { mockServer } from '@/test/server'
import { mockGuestAllowance } from '@mocks/handlers/guestAllowanceHandlers'
import * as reviewListApi from '@api/wrong-note/listReviewList'
import { ReviewDueLine } from '@app/dashboard/components/ReviewDueLine'
import { GUEST_SESSION_QUESTION_LIMIT } from '@nihongo/contracts/study/guest-limits'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  mockMode: true,
  mutate: vi.fn(),
  pending: false,
  failed: false
}))
vi.mock('@nihongo/browser/provider/ProtectedRouteProvider', () => ({
  useAuth: mocks.auth
}))
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
vi.mock('@nihongo/browser/libs/apiMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nihongo/browser/libs/apiMode')>()),
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

const renderHome = (initial = '/', memberLine?: ReactElement) =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <LearningHome memberLine={memberLine} />
    </MemoryRouter>
  )

it.each([
  [
    'ko',
    `오늘은 N5 문자·어휘 ${GUEST_SESSION_QUESTION_LIMIT}문제 풀어 볼까요?`,
    '급수 바꾸기',
    '과목 바꾸기',
    '바로 풀기'
  ],
  [
    'ja',
    `今日は N5 文字・語彙 を ${GUEST_SESSION_QUESTION_LIMIT}問解いてみませんか？`,
    'レベルを変える',
    '科目を変える',
    'すぐに解く'
  ]
] as const)(
  'asks a guest one sentence with N5 vocabulary and one start button (%s)',
  async (locale, sentence, levelLabel, subjectLabel, start) => {
    await appI18n.changeLanguage(locale)
    mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
    renderHome()
    expect(
      screen.getByRole('heading', { level: 1, name: sentence })
    ).toBeVisible()
    expect(
      screen.getByText(
        appI18n.t('home:today.guestGreeting', {
          total: 3,
          count: GUEST_SESSION_QUESTION_LIMIT
        })
      )
    ).toBeVisible()
    expect(screen.getByRole('combobox', { name: levelLabel })).toHaveValue('N5')
    expect(screen.getByRole('combobox', { name: subjectLabel })).toHaveValue(
      'VOCABULARY'
    )
    fireEvent.click(screen.getByRole('button', { name: start }))
    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        level: 'N5',
        subject: 'VOCABULARY',
        count: GUEST_SESSION_QUESTION_LIMIT,
        mode: 'RANDOM'
      },
      expect.anything()
    )
    // No "keep it with a login" line on the first screen (plan-notes §4).
    expect(document.querySelector('.home-more')).toBeNull()
  }
)

it.each([
  [
    'ko',
    `내일 또 N5 문자·어휘 ${GUEST_SESSION_QUESTION_LIMIT}문제 풀어요`,
    '오늘 3번을 다 풀었어요'
  ],
  [
    'ja',
    `明日また N5 文字・語彙 を ${GUEST_SESSION_QUESTION_LIMIT}問解きましょう`,
    '今日の3回をすべて解きました'
  ]
] as const)(
  'tells a guest at the daily limit about tomorrow (%s)',
  async (locale, sentence, limitTitle) => {
    await appI18n.changeLanguage(locale)
    mockGuestAllowance.setRemaining(0)
    mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
    renderHome()
    expect(
      await screen.findByRole('heading', { name: limitTitle })
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { level: 1, name: sentence })
    ).toBeVisible()
  }
)

it('starts a member from the last level and subject, changed by the underlined words', async () => {
  localStorage.setItem(
    LAST_PRACTICE_CHOICE_KEY,
    JSON.stringify({ level: 'N3', subject: 'GRAMMAR' })
  )
  mocks.auth.mockReturnValue({
    isReady: true,
    role: 'USER',
    user: { id: 'member', name: '데모', targetLevel: null }
  })
  const user = userEvent.setup()
  renderHome('/dashboard?view=learning')
  expect(screen.getByText('데모님, 왔네요')).toBeVisible()
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: '오늘은 N3 문법 10문제 풀어 볼까요?'
    })
  ).toBeVisible()
  await user.selectOptions(
    screen.getByRole('combobox', { name: '급수 바꾸기' }),
    'N1'
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: '과목 바꾸기' }),
    'READING'
  )
  fireEvent.click(screen.getByRole('button', { name: '바로 풀기' }))
  expect(mocks.mutate).toHaveBeenCalledWith(
    { level: 'N1', subject: 'READING', count: 10, mode: 'RANDOM' },
    expect.anything()
  )
  expect(screen.queryByText(appI18n.t('home:today.guestMore'))).toBeNull()
})

it('tells a member how many wrong answers wait and starts the same review as the wrong-note page', async () => {
  vi.spyOn(reviewListApi, 'listReviewList').mockResolvedValue({
    counts: { toReview: 4, reviewed: 1 },
    oldestToReview: { level: 'N4', subject: 'GRAMMAR' }
  } as never)
  renderHome('/dashboard?view=learning', <ReviewDueLine />)
  expect(await screen.findByText('복습할 문제도 4개 남아 있어요')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '복습' }))
  expect(mocks.mutate).toHaveBeenCalledWith(
    { level: 'N4', subject: 'GRAMMAR', mode: 'DAILY_REVIEW', count: 10 },
    expect.anything()
  )
})

it('shows nothing about review when no wrong answers wait', async () => {
  const list = vi.spyOn(reviewListApi, 'listReviewList').mockResolvedValue({
    counts: { toReview: 0, reviewed: 3 },
    oldestToReview: null
  } as never)
  renderHome('/dashboard?view=learning', <ReviewDueLine />)
  await vi.waitFor(() => expect(list).toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: '복습' })).toBeNull()
})

it('shows the start error in place and allows another try', () => {
  mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
  mocks.failed = true
  renderHome()
  expect(screen.getByRole('alert')).toBeVisible()
  const start = screen.getByRole('button', { name: '바로 풀기' })
  fireEvent.click(start)
  fireEvent.click(start)
  expect(mocks.mutate).toHaveBeenCalledTimes(2)
})

it('announces loading and prevents duplicate start requests', () => {
  mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
  mocks.pending = true
  renderHome()
  const start = screen.getByRole('button', {
    name: appI18n.t('home:approved.loading')
  })
  expect(start).toBeDisabled()
  expect(start).toHaveAttribute('aria-busy', 'true')
  fireEvent.click(start)
  expect(mocks.mutate).not.toHaveBeenCalled()
  // The words cannot change while a set is being made.
  expect(screen.getByRole('combobox', { name: '급수 바꾸기' })).toBeDisabled()
})

it("answers today's question in place, without a record, and keeps it on reopen", async () => {
  mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
  const user = userEvent.setup()
  const first = renderHome()
  const daily = await screen.findByRole('region', { name: '오늘의 한 문제' })
  const options = await within(daily).findAllByRole('button')
  expect(options).toHaveLength(4)
  expect(within(daily).getByText(/^N5 · /u)).toBeVisible()
  await user.click(options[0]!)
  expect(
    await within(daily).findByText(
      /^(정답이에요|아쉬워요. 정답은 [1-4]번이에요)$/u
    )
  ).toBeVisible()
  expect(
    options.every((option) => option.getAttribute('aria-disabled') === 'true')
  ).toBe(true)
  expect(options[0]).toHaveAttribute('aria-pressed', 'true')
  expect(mocks.mutate).not.toHaveBeenCalled()
  first.unmount()

  renderHome()
  const reopened = await screen.findByRole('region', { name: '오늘의 한 문제' })
  expect(
    await within(reopened).findByText(
      /^(정답이에요|아쉬워요. 정답은 [1-4]번이에요)$/u
    )
  ).toBeVisible()
})

it.each([
  [null, '일본어 해설이 아직 없어서 한국어 해설을 보여 드려요.'],
  ['日本語の解説', null]
])(
  "shows the Korean-explanation notice on today's question when Japanese is missing (%s)",
  async (explanationJa, notice) => {
    await appI18n.changeLanguage('ja')
    mockServer.use(
      http.get('*/api/v1/daily-question', async ({ request }) => {
        const response = await getResponse(dailyQuestionHandlers, request)
        const body = (await response!.json()) as {
          question: Record<string, unknown>
        }
        body.question.explanationJa = explanationJa
        return HttpResponse.json(body)
      })
    )
    const user = userEvent.setup()
    renderHome()
    const daily = await screen.findByRole('region', {
      name: appI18n.t('home:today.dailyLabel')
    })
    await user.click((await within(daily).findAllByRole('button'))[0]!)
    const noticeText = appI18n.t('common:explanation.japaneseUnavailable')
    if (notice) {
      expect(await within(daily).findByText(noticeText)).toBeVisible()
    } else {
      expect(await within(daily).findByText(/日本語の解説/u)).toBeVisible()
      expect(within(daily).queryByText(noticeText)).toBeNull()
    }
  }
)

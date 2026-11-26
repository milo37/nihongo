import {
  fireEvent,
  render as baseRender,
  screen,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LAST_PRACTICE_CHOICE_KEY } from '@app/practice/lastPracticeChoice'
import { MemoryRouter } from 'react-router'
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
import { LearningHome } from '@app/home/page'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { dailyQuestionHandlers } from '@/mocks/handlers/dailyQuestionHandlers'
import { mockServer } from '@/test/server'
import { mockGuestAllowance } from '@mocks/handlers/guestAllowanceHandlers'
import * as reviewListApi from '@api/wrong-note/listReviewList'
import { ReviewDueLine } from '@app/dashboard/components/ReviewDueLine'
import { WeekLine } from '@app/dashboard/components/WeekLine'
import * as resumableApi from '@api/study/listResumableStudySessions'
import * as dashboardApi from '@api/dashboard/getDashboardStatsV1'
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

const renderHome = (
  initial = '/',
  memberLine?: ReactElement,
  withWeekLine = false
) =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <LearningHome
        memberLine={memberLine}
        memberFootLine={
          withWeekLine ? (level) => <WeekLine level={level} /> : undefined
        }
      />
    </MemoryRouter>
  )

it.each([
  [
    'ko',
    `오늘은 N5 문자·어휘 ${GUEST_SESSION_QUESTION_LIMIT}문제 풀어 볼까요?`,
    '급수 바꾸기',
    '과목 바꾸기',
    '시작하기'
  ],
  [
    'ja',
    `今日は N5 文字・語彙 を ${GUEST_SESSION_QUESTION_LIMIT}問解いてみませんか？`,
    'レベルを変える',
    '科目を変える',
    '始める'
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
    const rule = screen.getByText(
      appI18n.t('home:today.guestGreeting', {
        total: 3,
        count: GUEST_SESSION_QUESTION_LIMIT
      })
    )
    expect(rule).toBeVisible()
    // JLP-859: the rule line is text only, without the three squares.
    expect(rule.children).toHaveLength(0)
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
    // #991: no count strip and no arrow; the sentence says the count.
    expect(document.querySelector('.home-strip')).toBeNull()
    expect(
      screen.getByRole('button', { name: start }).querySelector('svg')
    ).toBeNull()
    // Under the button only the rule line (plan-notes §4); #995: the
    // sign-in line sits at the foot, under today's question.
    expect(document.querySelector('.home-band-start .home-more')).toBeNull()
    const foot = document.querySelector('.home-foot') as HTMLElement
    expect(foot).toHaveTextContent(appI18n.t('home:today.guestBenefit'))
    expect(
      within(foot).getByRole('link', {
        name: appI18n.t('navigation:login')
      })
    ).toHaveAttribute('href', '/login?redirect=%2F')
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
    // #995: the sign-in card is already there; no second sign-in line.
    expect(document.querySelector('.home-foot')).toBeNull()
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
  renderHome('/')
  // JLP-859: no greeting line above the daily question.
  expect(screen.queryByText(/왔네요/u)).toBeNull()
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
  // #1244: a member's reading set starts at 5.
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: '오늘은 N1 독해 5문제 풀어 볼까요?'
    })
  ).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '시작하기' }))
  expect(mocks.mutate).toHaveBeenCalledWith(
    { level: 'N1', subject: 'READING', count: 5, mode: 'RANDOM' },
    expect.anything()
  )
  // A member sees no guest rule line and no tries count.
  expect(screen.queryByText(/로그인 없이 하루/u)).toBeNull()
  expect(screen.queryByText(/번 남음/u)).toBeNull()
})

it('tells a member how many wrong answers wait and starts the same review as the wrong-note page', async () => {
  vi.spyOn(reviewListApi, 'listReviewList').mockResolvedValue({
    counts: { toReview: 4, reviewed: 1 },
    oldestToReview: { level: 'N4', subject: 'GRAMMAR' }
  } as never)
  renderHome('/', <ReviewDueLine />)
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
  renderHome('/', <ReviewDueLine />)
  await vi.waitFor(() => expect(list).toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: '복습' })).toBeNull()
})

it("keeps today's question on the level picked in the sentence (#992)", async () => {
  mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
  const user = userEvent.setup()
  renderHome()
  const daily = await screen.findByRole('region', { name: '오늘의 한 문제' })
  // #1075: the head names the level only.
  expect(await within(daily).findByText('N5', { exact: true })).toBeVisible()
  await user.selectOptions(
    screen.getByRole('combobox', { name: '급수 바꾸기' }),
    'N2'
  )
  expect(await within(daily).findByText('N2', { exact: true })).toBeVisible()
})

it('remembers a picked word at once, before any start (#1075)', async () => {
  mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
  const user = userEvent.setup()
  renderHome()
  await user.selectOptions(
    screen.getByRole('combobox', { name: '급수 바꾸기' }),
    'N3'
  )
  expect(JSON.parse(localStorage.getItem(LAST_PRACTICE_CHOICE_KEY)!)).toEqual({
    level: 'N3',
    subject: 'VOCABULARY'
  })
  await user.selectOptions(
    screen.getByRole('combobox', { name: '과목 바꾸기' }),
    'GRAMMAR'
  )
  expect(JSON.parse(localStorage.getItem(LAST_PRACTICE_CHOICE_KEY)!)).toEqual({
    level: 'N3',
    subject: 'GRAMMAR'
  })
  expect(mocks.mutate).not.toHaveBeenCalled()
})

const member = { id: 'member', name: '데모', targetLevel: 'N2' }
const week = (counts: number[]) => ({
  dailyStudyCountLast7Days: counts.map((count, index) => ({
    date: `2026-11-0${index + 1}`,
    count
  }))
})

it('puts the unfinished set, then review, under [시작하기] for a member (#992)', async () => {
  mocks.auth.mockReturnValue({ isReady: true, role: 'USER', user: member })
  vi.spyOn(resumableApi, 'listResumableStudySessions').mockResolvedValue({
    data: {
      items: [
        {
          id: 'session-1',
          level: 'N2',
          subject: 'GRAMMAR',
          actualCount: 10,
          currentOrdinal: 4,
          practiceContractVersion: 2,
          resumeAvailability: 'SERVER'
        }
      ],
      total: 1
    }
  } as never)
  vi.spyOn(reviewListApi, 'listReviewList').mockResolvedValue({
    counts: { toReview: 3, reviewed: 0 },
    oldestToReview: { level: 'N2', subject: 'GRAMMAR' }
  } as never)
  vi.spyOn(dashboardApi, 'getDashboardStatsV1').mockResolvedValue(
    week([0, 0, 0, 0, 0, 0, 0]) as never
  )
  renderHome('/', <ReviewDueLine />, true)
  const resume = await screen.findByText('풀던 N2 문법, 10문제 중 4번까지')
  expect(
    within(resume).getByRole('link', { name: '이어 풀기' })
  ).toHaveAttribute('href', '/practice/session/session-1')
  const review = await screen.findByText('복습할 문제도 3개 남아 있어요')
  expect(
    resume.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  // #995: no "0 questions" line.
  expect(document.querySelector('.home-foot')).toBeNull()
})

it("counts this level's last 7 days at a member's foot and links to 마이 (#995)", async () => {
  mocks.auth.mockReturnValue({ isReady: true, role: 'USER', user: member })
  const stats = vi
    .spyOn(dashboardApi, 'getDashboardStatsV1')
    .mockResolvedValue(week([3, 0, 12, 5, 0, 10, 2]) as never)
  renderHome('/', undefined, true)
  const line = await screen.findByText('최근 7일 동안 N2 32문제를 풀었어요')
  expect(line).toHaveClass('home-foot')
  expect(within(line).getByRole('link', { name: '마이' })).toHaveAttribute(
    'href',
    '/account'
  )
  expect(stats).toHaveBeenCalledWith({ level: 'N2' })
})

it('says a failed start in a toast and allows another try (#1262)', () => {
  mocks.auth.mockReturnValue({ isReady: true, role: 'GUEST', user: null })
  mocks.failed = true
  renderHome()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(
    within(screen.getByRole('region', { name: '알림' })).getByText(
      appI18n.t('practice:setup.createError')
    )
  ).toBeVisible()
  const start = screen.getByRole('button', { name: '시작하기' })
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
  expect(start).toHaveAttribute('aria-disabled', 'true')
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
  expect(within(daily).getByText('N5', { exact: true })).toBeVisible()
  await user.click(options[0]!)
  expect(
    await within(daily).findByText(
      /^(맞았어요|아쉬워요. 정답은 [1-4]번이에요)$/u
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
      /^(맞았어요|아쉬워요. 정답은 [1-4]번이에요)$/u
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

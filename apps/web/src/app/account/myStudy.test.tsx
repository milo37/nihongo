import { Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getResponse, http, HttpResponse } from 'msw'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import type { GetDashboardStatsResponse } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { accountRoutes } from '@app/account/router'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { handlers } from '@mocks/handlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { subscribeApiError } from '@nihongo/browser/libs/errorBus'
import { mockServer } from '@/test/server'

const days = (counts: readonly number[]) =>
  counts.map((count, index) => ({
    date: `2026-11-0${index + 1}`,
    count
  }))

const fullStats: GetDashboardStatsResponse = {
  totalAnsweredCount: 25,
  correctCount: 16,
  correctRate: 64,
  wrongNoteCount: 4,
  solvedWrongNoteCount: 1,
  weakestSubject: 'READING',
  subjectStats: [
    {
      subject: 'VOCABULARY',
      answeredCount: 10,
      correctCount: 8,
      correctRate: 80
    },
    { subject: 'GRAMMAR', answeredCount: 10, correctCount: 6, correctRate: 60 },
    { subject: 'READING', answeredCount: 5, correctCount: 2, correctRate: 40 }
  ],
  recentStudySessions: [
    {
      id: '019d0000-0000-7000-8000-0000000000a1',
      level: 'N3',
      subject: 'GRAMMAR',
      mode: 'RANDOM',
      totalCount: 10,
      correctCount: 8,
      correctRate: 80,
      durationSec: 300,
      submittedAt: '2026-11-07T09:00:00.000Z'
    }
  ],
  dailyStudyCountLast7Days: days([12, 0, 20, 10, 0, 25, 15]),
  repeatedWrongQuestions: [
    {
      questionId: '019d0000-0000-7000-8000-0000000000b1',
      questionPreview: '「あたらしい」の 使い方が 正しいものは',
      level: 'N3',
      subject: 'VOCABULARY',
      wrongCount: 4,
      status: 'AGAIN'
    }
  ]
}

const fewStats: GetDashboardStatsResponse = {
  ...fullStats,
  totalAnsweredCount: 5,
  correctCount: 3,
  correctRate: 60,
  wrongNoteCount: 0,
  solvedWrongNoteCount: 0,
  weakestSubject: 'GRAMMAR',
  subjectStats: [
    {
      subject: 'VOCABULARY',
      answeredCount: 0,
      correctCount: 0,
      correctRate: 0
    },
    { subject: 'GRAMMAR', answeredCount: 5, correctCount: 3, correctRate: 60 },
    { subject: 'READING', answeredCount: 0, correctCount: 0, correctRate: 0 }
  ],
  repeatedWrongQuestions: []
}

const emptyStats: GetDashboardStatsResponse = {
  ...fewStats,
  totalAnsweredCount: 0,
  correctCount: 0,
  correctRate: 0,
  weakestSubject: null,
  subjectStats: fewStats.subjectStats.map((stat) => ({
    ...stat,
    answeredCount: 0,
    correctCount: 0,
    correctRate: 0
  })),
  recentStudySessions: [],
  dailyStudyCountLast7Days: days([0, 0, 0, 0, 0, 0, 0])
}

const statsLevels: (string | null)[] = []

const useStats = (stats: GetDashboardStatsResponse | 'error') => {
  let reads = 0
  mockServer.use(
    http.get('*/api/v1/dashboard', ({ request }) => {
      reads += 1
      statsLevels.push(new URL(request.url).searchParams.get('level'))
      return stats === 'error'
        ? HttpResponse.json(
            {
              code: 'INTERNAL_SERVER_ERROR',
              message: '실패',
              requestId: crypto.randomUUID(),
              retryable: false
            },
            { status: 500 }
          )
        : HttpResponse.json(stats)
    })
  )
  return () => reads
}

const renderAccount = () => {
  const router = createMemoryRouter(
    [
      {
        element: (
          <ProtectedRouteProvider>
            <Outlet />
          </ProtectedRouteProvider>
        ),
        children: accountRoutes
      }
    ],
    { initialEntries: ['/account'] }
  )
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <Suspense fallback={<p>확인 중</p>}>
            <RouterProvider router={router} />
          </Suspense>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
}

describe('마이페이지 내 학습', () => {
  beforeAll(async () => {
    await import('@app/account/page')
  })
  beforeEach(() => {
    mockDatabase.loginAs('USER')
    statsLevels.length = 0
  })

  it('과목별 푼 문제 수·정답률 3줄과 최근 학습만 보여 주고 분석·추천은 읽지 않는다', async () => {
    useStats(fullStats)
    let insightReads = 0
    mockServer.use(
      http.get('*/api/v1/dashboard/insights', () => {
        insightReads += 1
        return HttpResponse.json({})
      })
    )
    renderAccount()
    const section = await screen.findByRole('region', { name: 'N2 학습' })
    const rows = await within(section).findAllByRole('listitem')
    // JLP-851: the tier word is read after each rate; the mark and the bar
    // are decorative.
    expect(rows[0]).toHaveTextContent('문자·어휘10문제정답률80%높음')
    expect(rows[1]).toHaveTextContent('문법10문제정답률60%보통')
    expect(rows[2]).toHaveTextContent('독해5문제정답률40%낮음')
    const bars = rows
      .slice(0, 3)
      .map((row) => row.querySelector<HTMLElement>('[aria-hidden] > span'))
    expect(bars.map((bar) => bar?.style.width)).toEqual(['80%', '60%', '40%'])
    expect(bars.map((bar) => bar?.className.match(/bg-[\w-]+/u)?.[0])).toEqual([
      'bg-ink',
      'bg-warning',
      'bg-brand-strong'
    ])
    // One summary line: the server totals, the rate in its tier colour.
    const total = within(section).getByText('64%')
    expect(total).toHaveClass('text-warning')
    expect(total.parentElement).toHaveTextContent('정답률64%보통')
    expect(within(section).getByText('25')).toBeInTheDocument()
    // One recent session: no 'last five' line.
    expect(within(section).queryByRole('link', { name: '오답노트' })).toBeNull()
    expect(
      within(section).getByRole('link', { name: /N3 · 문법/u })
    ).toHaveTextContent('10문제 중 8개 맞음')
    // The login method shows once, in the account settings (v2.1 §6).
    expect(screen.queryByText('Google 계정으로 로그인 중')).toBeNull()
    expect(
      within(section).getByRole('link', { name: /N3 · 문법/u })
    ).toHaveAttribute(
      'href',
      '/practice/result/019d0000-0000-7000-8000-0000000000a1'
    )
    expect(within(section).queryByText(/가장 약한 과목/u)).toBeNull()
    expect(within(section).queryByText('자주 틀린 문제')).toBeNull()
    expect(within(section).queryByText('최근 7일')).toBeNull()
    expect(screen.queryByRole('heading', { name: '추천 학습' })).toBeNull()
    expect(insightReads).toBe(0)
    // JLP-850: the footer uses the top tab names and order.
    expect(
      within(screen.getByRole('contentinfo'))
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')])
    ).toEqual([
      ['이용 안내', '/legal'],
      ['계정·데이터', '/account/data'],
      ['신고·문의', '/support']
    ])
  })

  it('최근 학습이 5개면 아래 한 줄과 오답노트 링크를 보인다', async () => {
    const [first] = fullStats.recentStudySessions
    if (!first) throw new Error('fixture')
    useStats({
      ...fullStats,
      recentStudySessions: [20, 16, 15, 12, 11].map((correct, index) => ({
        ...first,
        id: `019d0000-0000-7000-8000-0000000000c${index}`,
        totalCount: 20,
        correctCount: correct,
        correctRate: correct * 5
      }))
    })
    renderAccount()
    const section = await screen.findByRole('region', { name: 'N2 학습' })
    const links = await within(section).findAllByRole('link', {
      name: /N3 · 문법/u
    })
    expect(
      links.map((link) => link.textContent?.replace(/^.*맞음/u, ''))
    ).toEqual(['100%높음', '80%높음', '75%보통', '60%보통', '55%낮음'])
    const more = within(section).getByRole('link', { name: '오답노트' })
    expect(more).toHaveAttribute('href', '/wrong-notes')
    expect(more.closest('p')).toHaveTextContent(
      '최근 5번까지 보여요. 틀린 문제는 오답노트에 모여 있어요.'
    )
  })

  it('목표 급수 기록이 없으면 그 급수로 첫 학습 안내를 보여 준다', async () => {
    useStats(emptyStats)
    renderAccount()
    expect(
      await screen.findByText('아직 N2 문제를 풀지 않았어요')
    ).toBeInTheDocument()
    expect(
      screen.getByText('N2 문제를 풀면 과목별 정답률이 여기 나와요.')
    ).toBeInTheDocument()
    // No 0% in a tier colour.
    expect(screen.queryByText('0%')).toBeNull()
    // Home starts at the target level, so the link carries no level.
    expect(screen.getByRole('link', { name: 'N2 문제 풀기' })).toHaveAttribute(
      'href',
      '/'
    )
  })

  it('JLP-853: 목표 급수 기록만 읽고, 급수를 바꾸면 같은 화면에서 새 급수로 다시 읽는다', async () => {
    useStats(fullStats)
    renderAccount()
    expect(
      await screen.findByRole('region', { name: 'N2 학습' })
    ).toBeInTheDocument()
    await screen.findByText('64%')
    expect(statsLevels).toEqual(['N2'])
    useStats(emptyStats)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '목표 급수' }),
      'N3'
    )
    const section = await screen.findByRole('region', { name: 'N3 학습' })
    expect(
      await within(section).findByText('아직 N3 문제를 풀지 않았어요')
    ).toBeInTheDocument()
    expect(statsLevels.at(-1)).toBe('N3')
  })

  it('JLP-853: 목표 급수가 없으면 N5 기록으로 보여 준다', async () => {
    mockServer.use(
      http.get('*/api/v1/me', async ({ request }) => {
        const response = await getResponse(handlers, request)
        if (!response) throw new Error('no /me handler')
        const body = (await response.json()) as {
          user: Record<string, unknown> | null
        }
        return HttpResponse.json({
          ...body,
          user: body.user ? { ...body.user, targetLevel: null } : null
        })
      })
    )
    useStats(fullStats)
    renderAccount()
    expect(
      await screen.findByRole('region', { name: 'N5 학습' })
    ).toBeInTheDocument()
    await waitFor(() => expect(statsLevels).toEqual(['N5']))
  })

  it('안 푼 과목은 기록 없음으로 보여 준다', async () => {
    useStats(fewStats)
    renderAccount()
    const section = await screen.findByRole('region', { name: 'N2 학습' })
    expect(await within(section).findAllByText('기록 없음')).toHaveLength(2)
    expect(within(section).getByText('문법')).toBeInTheDocument()
  })

  it('통계 실패는 내 학습 안에서만 알리고 다시 시도하며 계정 영역은 그대로 둔다', async () => {
    const reads = useStats('error')
    const banner: unknown[] = []
    const unsubscribe = subscribeApiError((error) => banner.push(error))
    renderAccount()
    const section = await screen.findByRole('region', { name: 'N2 학습' })
    const alert = await within(section).findByRole('alert')
    expect(alert).toHaveTextContent('학습 기록을 불러오지 못했어요.')
    expect(alert).toHaveClass('auth-error')
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeEnabled()
    // The card owns this failure, so the shared error banner stays quiet.
    expect(banner).toEqual([])
    unsubscribe()
    const before = reads()
    await userEvent.click(
      within(section).getByRole('button', { name: '다시 시도' })
    )
    expect(reads()).toBeGreaterThan(before)
  })
})

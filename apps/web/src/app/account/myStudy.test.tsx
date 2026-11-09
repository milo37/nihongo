import { Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import type { GetDashboardStatsResponse } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { accountRoutes } from '@app/account/router'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'
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

const useStats = (stats: GetDashboardStatsResponse | 'error') => {
  let reads = 0
  mockServer.use(
    http.get('*/api/v1/dashboard', () => {
      reads += 1
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
    const section = await screen.findByRole('region', { name: '내 학습' })
    const rows = await within(section).findAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('문자·어휘10문제 · 정답률 80%')
    expect(rows[1]).toHaveTextContent('문법10문제 · 정답률 60%')
    expect(rows[2]).toHaveTextContent('독해5문제 · 정답률 40%')
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
    expect(screen.getByRole('link', { name: '이용 안내' })).toHaveAttribute(
      'href',
      '/legal'
    )
    expect(screen.getByRole('link', { name: '도움말' })).toHaveAttribute(
      'href',
      '/support'
    )
  })

  it('푼 문제가 없으면 첫 학습 안내를 보여 준다', async () => {
    useStats(emptyStats)
    renderAccount()
    expect(await screen.findByText('아직 푼 문제가 없어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '첫 학습 시작' })).toHaveAttribute(
      'href',
      '/'
    )
  })

  it('안 푼 과목은 기록 없음으로 보여 준다', async () => {
    useStats(fewStats)
    renderAccount()
    const section = await screen.findByRole('region', { name: '내 학습' })
    expect(await within(section).findAllByText('아직 기록 없음')).toHaveLength(
      2
    )
    expect(within(section).getByText('문법')).toBeInTheDocument()
  })

  it('통계 실패는 내 학습 안에서만 알리고 다시 시도하며 계정 영역은 그대로 둔다', async () => {
    const reads = useStats('error')
    const banner: unknown[] = []
    const unsubscribe = subscribeApiError((error) => banner.push(error))
    renderAccount()
    const section = await screen.findByRole('region', { name: '내 학습' })
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

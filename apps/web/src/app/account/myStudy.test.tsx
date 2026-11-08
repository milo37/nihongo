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

const studySection = () => screen.getByRole('region', { name: '내 학습' })

describe('마이페이지 내 학습', () => {
  beforeAll(async () => {
    await import('@app/account/page')
  })
  beforeEach(() => {
    mockDatabase.loginAs('USER')
  })

  it('전체 기간 숫자·과목 막대·7일·최근 학습·자주 틀린 문제와 추천을 보여 준다', async () => {
    useStats(fullStats)
    renderAccount()
    expect(await screen.findByText('푼 문제')).toBeInTheDocument()
    expect(screen.getByText('푼 문제').parentElement).toHaveTextContent(
      '25문제'
    )
    const section = studySection()
    expect(within(section).getByText('64')).toBeInTheDocument()
    expect(within(section).getByText('해결 1 · 4개 중')).toBeInTheDocument()
    expect(
      within(section).getByRole('img', { name: '독해 40%' })
    ).toBeInTheDocument()
    expect(
      within(section).getByText('가장 약한 과목: 독해')
    ).toBeInTheDocument()
    expect(
      within(section).getByRole('link', { name: '독해 학습 시작 →' })
    ).toHaveAttribute('href', '/practice?subject=READING')
    expect(
      within(section).getByRole('img', {
        name: '7일 중 5일 학습, 합계 82문제'
      })
    ).toBeInTheDocument()
    expect(
      within(section).getByRole('link', { name: /N3 · 문법/u })
    ).toHaveAttribute(
      'href',
      '/practice/result/019d0000-0000-7000-8000-0000000000a1'
    )
    expect(
      within(section).getByRole('link', { name: /あたらしい/u })
    ).toHaveAttribute(
      'href',
      '/wrong-notes/019d0000-0000-7000-8000-0000000000b1'
    )
    expect(within(section).getByText('4번 틀림')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: '추천 학습' })
    ).toBeInTheDocument()
  })

  it('푼 문제가 없으면 첫 학습 안내와 서버의 대체 추천을 보여 준다', async () => {
    useStats(emptyStats)
    renderAccount()
    expect(await screen.findByText('아직 푼 문제가 없어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '첫 학습 시작' })).toHaveAttribute(
      'href',
      '/'
    )
    expect(
      await screen.findByRole('heading', { name: '추천 학습' })
    ).toBeInTheDocument()
  })

  it('적은 데이터는 안내를 보이고 약한 과목 표시를 숨긴다', async () => {
    useStats(fewStats)
    renderAccount()
    expect(
      await screen.findByText('문제를 더 풀수록 분석이 정확해져요.')
    ).toBeInTheDocument()
    const section = studySection()
    expect(within(section).getAllByText('아직 기록 없음')).toHaveLength(2)
    expect(within(section).queryByText(/가장 약한 과목/u)).toBeNull()
    expect(within(section).queryByText('자주 틀린 문제')).toBeNull()
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

  it('추천만 실패하면 알림 없이 추천 영역을 숨긴다', async () => {
    useStats(fullStats)
    mockServer.use(
      http.get('*/api/v1/dashboard/insights', () =>
        HttpResponse.json(
          {
            code: 'INTERNAL_SERVER_ERROR',
            message: '실패',
            requestId: crypto.randomUUID(),
            retryable: false
          },
          { status: 500 }
        )
      )
    )
    renderAccount()
    await screen.findByText('푼 문제')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: '추천 학습' })
    ).not.toBeInTheDocument()
  })
})

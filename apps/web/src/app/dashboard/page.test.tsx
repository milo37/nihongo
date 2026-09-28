import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { getDashboardStatsQuerySchema } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { dashboardInsightsConformanceFixture } from '@nihongo/contracts/testing/dashboard-insights-conformance'
import { DashboardPage } from '@app/dashboard/page'
import { queryClient } from '@libs/queryClient'
import { toContractDashboardStats } from '@mocks/adapters/dashboardContractAdapter'
import { toContractDashboardInsights } from '@mocks/adapters/dashboardInsightsContractAdapter'
import { toStableMockUuid } from '@mocks/adapters/questionContractAdapter'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const createTestQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })

const renderDashboard = (client: QueryClient = queryClient): void => {
  const router = createMemoryRouter(
    [
      {
        path: '/dashboard',
        element: (
          <ProtectedRouteProvider>
            <DashboardPage />
          </ProtectedRouteProvider>
        )
      }
    ],
    { initialEntries: ['/dashboard'] }
  )

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

const createDeferred = <Value,>(): {
  promise: Promise<Value>
  resolve: (value: Value) => void
} => {
  let resolve = (_value: Value): void => {
    throw new Error('deferred가 초기화되지 않았습니다.')
  }
  const promise = new Promise<Value>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

describe('DashboardPage', () => {
  it('재시도 성공 후 화면 제목으로 포커스를 복원한다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const stats = toContractDashboardStats(
      mockDatabase.getCanonicalDashboardRecord(currentUser.id),
      getDashboardStatsQuerySchema.parse({})
    )
    let requestCount = 0
    mockServer.use(
      http.get('*/api/v1/dashboard', () => {
        requestCount += 1
        return requestCount <= 2
          ? HttpResponse.json(
              {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'temporary error',
                requestId: crypto.randomUUID(),
                retryable: true
              },
              { status: 500 }
            )
          : HttpResponse.json(stats)
      })
    )
    renderDashboard()

    await screen.findByRole(
      'heading',
      { name: '누적 대시보드를 불러오지 못했습니다' },
      { timeout: 3000 }
    )
    await user.click(
      screen.getByRole('button', { name: '누적 통계 다시 시도' })
    )
    const heading = await screen.findByRole('heading', {
      name: '학습 흐름을 확인하세요'
    })
    await vi.waitFor(() => expect(heading).toHaveFocus())
  })

  it('반복 오답에서 복습 센터와 안전한 대시보드 복귀 상세 링크를 제공한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const questionId = '018f6b7a-1f4b-7d5e-8a91-0000000000d1'
    const baseStats = toContractDashboardStats(
      mockDatabase.getCanonicalDashboardRecord(currentUser.id),
      getDashboardStatsQuerySchema.parse({})
    )
    mockServer.use(
      http.get('*/api/v1/dashboard', () =>
        HttpResponse.json({
          ...baseStats,
          totalAnsweredCount: 1,
          correctCount: 0,
          correctRate: 0,
          wrongNoteCount: Math.max(baseStats.wrongNoteCount, 1),
          subjectStats: baseStats.subjectStats.map((subject) =>
            subject.subject === 'VOCABULARY'
              ? {
                  ...subject,
                  answeredCount: 1,
                  correctCount: 0,
                  correctRate: 0
                }
              : subject
          ),
          repeatedWrongQuestions: [
            {
              questionId,
              questionPreview: '대시보드 링크 확인용 오답',
              level: 'N5',
              subject: 'VOCABULARY',
              wrongCount: 2,
              status: 'AGAIN'
            }
          ]
        })
      )
    )
    renderDashboard()

    expect(
      await screen.findByRole('link', { name: '복습 센터에서 보기' })
    ).toHaveAttribute('href', '/wrong-notes?view=REPEATED&sort=MOST_WRONG')
    expect(
      screen.getByRole('link', { name: '대시보드 링크 확인용 오답' })
    ).toHaveAttribute(
      'href',
      `/wrong-notes/${questionId}?returnTo=%2Fdashboard`
    )
  })

  it('누적 summary와 최근 insights를 첫 render에서 병렬 요청한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const stats = toContractDashboardStats(
      mockDatabase.getCanonicalDashboardRecord(currentUser.id),
      getDashboardStatsQuerySchema.parse({})
    )
    const summaryDeferred = createDeferred<typeof stats>()
    const insightsDeferred =
      createDeferred<typeof dashboardInsightsConformanceFixture>()
    const started = new Set<string>()
    mockServer.use(
      http.get('*/api/v1/dashboard', async () => {
        started.add('summary')
        return HttpResponse.json(await summaryDeferred.promise)
      }),
      http.get('*/api/v1/dashboard/insights', async () => {
        started.add('insights')
        return HttpResponse.json(await insightsDeferred.promise)
      })
    )

    renderDashboard(createTestQueryClient())

    await vi.waitFor(() => {
      expect(started).toEqual(new Set(['summary', 'insights']))
    })
    await act(async () => {
      summaryDeferred.resolve(stats)
      insightsDeferred.resolve(dashboardInsightsConformanceFixture)
    })

    expect(
      await screen.findByRole('heading', {
        name: '아직 학습 기록이 없습니다'
      })
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', {
        name: '약점과 다음 학습 추천'
      })
    ).toBeInTheDocument()
  })

  it('insights 부분 실패에서도 누적 summary를 유지하고 재시도 성공 후 섹션 제목으로 포커스를 복원한다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    let requestCount = 0
    mockServer.use(
      http.get('*/api/v1/dashboard/insights', () => {
        requestCount += 1
        return requestCount === 1
          ? HttpResponse.json(
              {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'temporary insights error',
                requestId: crypto.randomUUID(),
                retryable: true
              },
              { status: 500 }
            )
          : HttpResponse.json(dashboardInsightsConformanceFixture)
      })
    )

    renderDashboard(createTestQueryClient())

    expect(
      await screen.findByRole('heading', {
        name: '아직 학습 기록이 없습니다'
      })
    ).toBeInTheDocument()
    await screen.findByRole('heading', {
      name: '학습 인사이트를 불러오지 못했습니다'
    })
    await user.click(
      screen.getByRole('button', { name: '최근 인사이트 다시 시도' })
    )
    const heading = await screen.findByRole('heading', {
      name: '약점과 다음 학습 추천'
    })

    await vi.waitFor(() => expect(heading).toHaveFocus())
  })

  it('표본 없음과 목표 급수 fallback을 서로 다른 비색상 상태로 안내한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)

    renderDashboard(createTestQueryClient())

    expect(
      await screen.findByRole('heading', {
        name: '최근 90일 학습 기록이 없습니다'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: '분석 기준을 충족한 약점이 없습니다'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText('목표 급수의 다음 문제를 풀어보세요')
    ).toBeInTheDocument()
    expect(screen.getByText(/표본이 없는 값은 0%가 아니라/)).toBeVisible()
  })

  it('최근 풀이 표본이 없어도 현재 복습 큐 수치를 숨기지 않는다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const questionId = toStableMockUuid('question', 'due-without-attempts')
    const insights = toContractDashboardInsights({
      answers: [],
      currentCatalog: [
        {
          level: 'N2',
          questionId,
          questionText: '복습 예정 문제',
          questionType: 'SENTENCE_ORDER',
          subject: 'GRAMMAR'
        }
      ],
      observedAt: '2026-09-28T12:00:00.000Z',
      sessions: [],
      targetLevel: 'N2',
      wrongNotes: [
        {
          isAvailable: true,
          lastWrongAt: '2026-09-20T12:00:00.000Z',
          level: 'N2',
          nextReviewAt: '2026-09-28T10:00:00.000Z',
          questionId,
          questionText: '복습 예정 문제',
          status: 'AGAIN',
          subject: 'GRAMMAR',
          wrongCount: 2
        }
      ]
    })
    mockServer.use(
      http.get('*/api/v1/dashboard/insights', () => HttpResponse.json(insights))
    )

    renderDashboard(createTestQueryClient())

    await screen.findByRole('heading', {
      name: '최근 90일 학습 기록이 없습니다'
    })
    expect(screen.getByText('복습 예정').parentElement).toHaveTextContent(
      '1문제'
    )
    expect(screen.getByText('반복 오답').parentElement).toHaveTextContent(
      '1문제'
    )
    expect(screen.getByText('최근 정답률').parentElement).toHaveTextContent(
      '표본 없음'
    )
  })

  it('목표 급수 null을 임의 급수로 대체하지 않고 setup 추천과 일치시킨다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    const userWithoutTarget = {
      id: currentUser.id,
      name: currentUser.name,
      role: currentUser.role,
      targetLevel: null
    }
    useAppStore.getState().setCurrentUser(userWithoutTarget)
    const insights = toContractDashboardInsights({
      answers: [],
      currentCatalog: [],
      observedAt: '2026-09-28T12:00:00.000Z',
      sessions: [],
      targetLevel: null,
      wrongNotes: []
    })
    mockServer.use(
      http.get('*/api/v1/me', () =>
        HttpResponse.json({ kind: 'USER', user: userWithoutTarget })
      ),
      http.get('*/api/v1/dashboard/insights', () => HttpResponse.json(insights))
    )

    renderDashboard(createTestQueryClient())

    expect(await screen.findByText('미설정')).toBeVisible()
    expect(screen.getByText('목표 급수를 먼저 설정해 주세요')).toBeVisible()
    expect(screen.queryByText('N3')).not.toBeInTheDocument()
  })

  it('두 read가 모두 실패해도 재시도 control의 accessible name을 구분한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const failure = {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'temporary error',
      requestId: crypto.randomUUID(),
      retryable: true
    }
    mockServer.use(
      http.get('*/api/v1/dashboard', () =>
        HttpResponse.json(failure, { status: 500 })
      ),
      http.get('*/api/v1/dashboard/insights', () =>
        HttpResponse.json(failure, { status: 500 })
      )
    )

    renderDashboard(createTestQueryClient())

    expect(
      await screen.findByRole('button', { name: '누적 통계 다시 시도' })
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: '최근 인사이트 다시 시도' })
    ).toBeEnabled()
  })

  it('차트와 같은 수치를 키보드 접근 가능한 표와 한국어 추천 근거로 제공한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    mockServer.use(
      http.get('*/api/v1/dashboard/insights', () =>
        HttpResponse.json(dashboardInsightsConformanceFixture)
      )
    )

    renderDashboard(createTestQueryClient())

    const tableRegion = await screen.findByRole('region', {
      name: '최근 90일 급수별 정답률 상세 표'
    })
    expect(tableRegion).toHaveAttribute('tabindex', '0')
    expect(screen.getAllByText('37.5%').length).toBeGreaterThan(0)
    expect(
      screen.getByText(/문장 배열 유형에서 8회 중 5회 틀렸습니다/)
    ).toBeVisible()
    expect(screen.getByText('약점 연습 · N2 문법 · 5문제')).toBeVisible()
  })
})

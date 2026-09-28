import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type {
  DashboardRecommendation,
  GetDashboardInsightsResponse
} from '@nihongo/contracts/dashboard/get-dashboard-insights'
import { getDashboardStatsQuerySchema } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { dashboardInsightsConformanceFixture } from '@nihongo/contracts/testing/dashboard-insights-conformance'
import { practiceFlowConformanceFixture } from '@nihongo/contracts/testing/practice-flow-conformance'
import { reviewCenterConformanceFixture } from '@nihongo/contracts/testing/review-center-conformance'
import { apiClient } from '@api/config'
import { getStudySessionV2 } from '@api/study/getStudySessionV2'
import { toDashboardInsightsView } from '@app/dashboard/adapters/dashboardInsightsView'
import { DashboardPage } from '@app/dashboard/page'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
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

const renderDashboard = (
  client: QueryClient = queryClient
): ReturnType<typeof createMemoryRouter> => {
  const router = createMemoryRouter(
    [
      {
        path: '/dashboard',
        element: (
          <ProtectedRouteProvider>
            <DashboardPage />
          </ProtectedRouteProvider>
        )
      },
      { path: '/practice', element: <p>연습 조건 화면</p> },
      {
        path: '/practice/session/:sessionId',
        element: <p>연습 세션 화면</p>
      },
      {
        path: '/practice/result/:sessionId',
        element: <p>학습 결과 화면</p>
      }
    ],
    { initialEntries: ['/dashboard'] }
  )

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  return router
}

const cacheDashboardRecommendations = (
  client: QueryClient,
  recommendations: DashboardRecommendation[],
  personalizationFallbackReason: GetDashboardInsightsResponse['personalizationFallbackReason'] = null
): void => {
  client.setQueryData(
    dashboardQueries.insights().queryKey,
    toDashboardInsightsView({
      ...dashboardInsightsConformanceFixture,
      personalizationFallbackReason,
      recommendations
    })
  )
}

const targetLevelReadingRecommendation: DashboardRecommendation = {
  rank: 1,
  kind: 'TARGET_LEVEL_PRACTICE',
  reason: {
    code: 'TARGET_LEVEL_RECENT_GAP',
    catalogCount: 3,
    nonRecentCount: 3,
    lastStudiedAt: null,
    level: 'N3',
    subject: 'READING'
  },
  action: {
    kind: 'START_SESSION',
    mode: 'RANDOM',
    level: 'N3',
    subject: 'READING',
    count: 5
  }
}

const weaknessRecommendation: DashboardRecommendation = {
  rank: 1,
  kind: 'RECENT_LOW_ACCURACY_TYPE',
  reason: {
    code: 'RECENT_LOW_ACCURACY_TYPE',
    questionType: 'SENTENCE_ORDER',
    attemptedCount: 8,
    incorrectCount: 5,
    errorRateBasisPoints: 6_250,
    scoreBasisPoints: 3_000,
    actionableCandidateCount: 3
  },
  action: {
    kind: 'START_SESSION',
    mode: 'WEAKNESS',
    level: 'N2',
    subject: 'GRAMMAR',
    count: 5
  }
}

const targetedRecommendation: DashboardRecommendation = {
  rank: 1,
  kind: 'REPEATED_WRONG',
  reason: {
    code: 'REPEATED_WRONG_COUNT',
    level: 'N5',
    subject: 'VOCABULARY',
    questionId: reviewCenterConformanceFixture.targetedQuestionId,
    questionPreview: '반복 오답 추천 문제',
    wrongCount: 2,
    lastWrongAt: '2026-09-27T10:00:00.000Z'
  },
  action: {
    kind: 'START_TARGETED_REVIEW',
    questionId: reviewCenterConformanceFixture.targetedQuestionId
  }
}

const staleWeaknessRecommendation: DashboardRecommendation = {
  rank: 2,
  kind: 'STALE_WEAK_SUBJECT',
  reason: {
    code: 'STALE_WEAK_SUBJECT',
    attemptedCount: 5,
    incorrectCount: 2,
    errorRateBasisPoints: 4_000,
    scoreBasisPoints: 700,
    ageDays: 40,
    actionableCandidateCount: 3
  },
  action: {
    kind: 'START_SESSION',
    mode: 'WEAKNESS',
    level: 'N3',
    subject: 'READING',
    count: 5
  }
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

  it('태그 제한 안내를 tag tab 안에서만 노출한다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    mockServer.use(
      http.get('*/api/v1/dashboard/insights', () =>
        HttpResponse.json({
          ...dashboardInsightsConformanceFixture,
          stats: {
            ...dashboardInsightsConformanceFixture.stats,
            byTag: Array.from({ length: 100 }, (_, index) => ({
              ...dashboardInsightsConformanceFixture.stats.byTag[0],
              tagId: toStableMockUuid('dashboard-tag', String(index)),
              tagLabel: `태그 ${index + 1}`
            })).toSorted((left, right) =>
              left.tagId.localeCompare(right.tagId)
            ),
            byTagTotal: 101,
            byTagTruncated: true
          }
        })
      )
    )

    renderDashboard(createTestQueryClient())

    await screen.findByText('약점과 다음 학습 추천')
    await user.click(screen.getByText('유형·태그 세부 통계 보기'))

    expect(
      screen.queryByText('태그 전체 101개 중 최대 100개를 표시합니다.')
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '태그' }))

    expect(
      screen.getByText('태그 전체 101개 중 최대 100개를 표시합니다.')
    ).toBeVisible()

    await user.click(screen.getByRole('tab', { name: '문제 유형' }))
    expect(
      screen.queryByText('태그 전체 101개 중 최대 100개를 표시합니다.')
    ).not.toBeInTheDocument()
  })

  it('명시적 CTA 전에는 command를 보내지 않고 65문항 독해 부족을 actualCount 축소로 유지한다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const client = createTestQueryClient()
    cacheDashboardRecommendations(client, [targetLevelReadingRecommendation])
    const post = vi.spyOn(apiClient, 'post')
    const router = renderDashboard(client)

    const startButton = await screen.findByRole('button', {
      name: '일반 연습 시작하기: 일반 연습 · N3 독해 · 5문제'
    })
    expect(post).not.toHaveBeenCalled()

    await user.click(startButton)

    await vi.waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/practice\/session\//u)
    )
    expect(post).toHaveBeenCalledWith(
      '/v1/study-sessions',
      {
        count: 5,
        level: 'N3',
        mode: 'RANDOM',
        subject: 'READING'
      },
      { headers: { 'X-Nihongo-Practice-Contract': '2' } }
    )

    const sessionId = useAppStore.getState().sessionId
    if (!sessionId) throw new Error('추천으로 생성된 세션이 필요합니다.')
    const created = await getStudySessionV2(sessionId)
    expect(created.data.session).toMatchObject({
      actualCount: 3,
      mode: 'RANDOM',
      requestedCount: 5,
      usedFallback: false
    })
  })

  it('session 후보 소진 시 mode를 바꾸지 않고 안내에 포커스한 뒤 insights만 다시 읽는다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const client = createTestQueryClient()
    cacheDashboardRecommendations(client, [weaknessRecommendation])
    const postBodies: unknown[] = []
    const refreshGate = createDeferred<void>()
    let insightsRequestCount = 0
    mockServer.use(
      http.post('*/api/v1/study-sessions', async ({ request }) => {
        postBodies.push(await request.json())
        return HttpResponse.json(
          {
            code: 'NO_ELIGIBLE_QUESTIONS',
            message: '선택한 조건에 출제 가능한 문제가 없습니다.',
            requestId: crypto.randomUUID(),
            retryable: false
          },
          { status: 404 }
        )
      }),
      http.get('*/api/v1/dashboard/insights', async () => {
        insightsRequestCount += 1
        await refreshGate.promise
        return HttpResponse.json(dashboardInsightsConformanceFixture)
      })
    )
    const router = renderDashboard(client)

    const startButton = await screen.findByRole('button', {
      name: '약점 연습 시작하기: 약점 연습 · N2 문법 · 5문제'
    })
    await user.click(startButton)

    const notice = await screen.findByText(
      /요청한 모드는 다른 모드로 바꾸지 않았으며/u
    )
    await vi.waitFor(() => expect(notice).toHaveFocus())
    await vi.waitFor(() => expect(insightsRequestCount).toBe(1))
    expect(startButton).toBeDisabled()
    await user.click(startButton)
    expect(postBodies).toHaveLength(1)

    await act(async () => refreshGate.resolve())
    const refreshedNotice =
      await screen.findByText(/최신 추천을 새로 확인했습니다/u)
    await vi.waitFor(() => expect(refreshedNotice).toHaveFocus())
    await vi.waitFor(() =>
      expect(
        client.getQueryState(dashboardQueries.insights().queryKey)
      ).toMatchObject({ fetchStatus: 'idle', status: 'success' })
    )
    expect(postBodies).toEqual([
      {
        count: 5,
        level: 'N2',
        mode: 'WEAKNESS',
        subject: 'GRAMMAR'
      }
    ])
    expect(router.state.location.pathname).toBe('/dashboard')
  })

  it('추천 command가 pending인 동안 중복 클릭과 두 번째 POST를 차단한다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const client = createTestQueryClient()
    cacheDashboardRecommendations(client, [weaknessRecommendation])
    const responseGate = createDeferred<void>()
    let postCount = 0
    mockServer.use(
      http.post('*/api/v1/study-sessions', async () => {
        postCount += 1
        await responseGate.promise
        return HttpResponse.json(
          {
            code: 'NO_ELIGIBLE_QUESTIONS',
            message: '선택한 조건에 출제 가능한 문제가 없습니다.',
            requestId: crypto.randomUUID(),
            retryable: false
          },
          { status: 404 }
        )
      })
    )
    renderDashboard(client)

    const startButton = await screen.findByRole('button', {
      name: '약점 연습 시작하기: 약점 연습 · N2 문법 · 5문제'
    })
    await user.dblClick(startButton)

    await vi.waitFor(() => expect(postCount).toBe(1))
    expect(
      screen.getByRole('button', {
        name: '약점 연습 시작하기: 약점 연습 · N2 문법 · 5문제'
      })
    ).toBeDisabled()

    await act(async () => responseGate.resolve())
    await screen.findByText(/요청한 모드는 다른 모드로 바꾸지 않았으며/u)
    expect(postCount).toBe(1)
  })

  it('후보 소진 뒤 insights 갱신도 실패하면 stale CTA를 잠그고 수동 재시도 성공 때만 푼다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const client = createTestQueryClient()
    cacheDashboardRecommendations(client, [
      weaknessRecommendation,
      targetedRecommendation
    ])
    const manualRetryGate = createDeferred<void>()
    let postCount = 0
    let targetedPostCount = 0
    let insightsRequestCount = 0
    mockServer.use(
      http.post('*/api/v1/study-sessions', () => {
        postCount += 1
        return HttpResponse.json(
          {
            code: 'NO_ELIGIBLE_QUESTIONS',
            message: '선택한 조건에 출제 가능한 문제가 없습니다.',
            requestId: crypto.randomUUID(),
            retryable: false
          },
          { status: 404 }
        )
      }),
      http.post('*/api/v1/wrong-notes/:questionId/review-session', () => {
        targetedPostCount += 1
        return HttpResponse.json({}, { status: 500 })
      }),
      http.get('*/api/v1/dashboard/insights', async () => {
        insightsRequestCount += 1
        if (insightsRequestCount === 1) {
          return HttpResponse.json(
            {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'temporary insights error',
              requestId: crypto.randomUUID(),
              retryable: true
            },
            { status: 500 }
          )
        }
        await manualRetryGate.promise
        return HttpResponse.json(dashboardInsightsConformanceFixture)
      })
    )
    renderDashboard(client)

    const startButton = await screen.findByRole('button', {
      name: '약점 연습 시작하기: 약점 연습 · N2 문법 · 5문제'
    })
    await user.click(startButton)

    const failureNotice = await screen.findByText(/잠시 비활성화했습니다/u)
    await vi.waitFor(() => expect(failureNotice).toHaveFocus())
    expect(startButton).toBeDisabled()
    await user.click(startButton)
    expect(postCount).toBe(1)

    await user.click(
      screen.getByRole('button', { name: '최근 인사이트 다시 시도' })
    )
    await vi.waitFor(() => expect(insightsRequestCount).toBe(2))
    const targetedButton = screen.getByRole('button', {
      name: '이 문제만 복습하기: 반복 오답 1문제 집중 복습'
    })
    expect(targetedButton).toBeDisabled()
    await user.click(targetedButton)
    expect(targetedPostCount).toBe(0)

    await act(async () => manualRetryGate.resolve())
    await vi.waitFor(() => expect(failureNotice).not.toBeInTheDocument())
    expect(
      screen.getByRole('button', {
        name: '약점 연습 시작하기: 약점 연습 · N2 문법 · 5문제'
      })
    ).toBeEnabled()
  })

  it('동시에 표시되는 두 약점 추천 CTA를 급수와 과목으로 구분한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const client = createTestQueryClient()
    cacheDashboardRecommendations(client, [
      weaknessRecommendation,
      staleWeaknessRecommendation
    ])

    renderDashboard(client)

    expect(
      await screen.findByRole('button', {
        name: '약점 연습 시작하기: 약점 연습 · N2 문법 · 5문제'
      })
    ).toBeEnabled()
    expect(
      screen.getByRole('button', {
        name: '약점 연습 시작하기: 약점 연습 · N3 독해 · 5문제'
      })
    ).toBeEnabled()
  })

  it('반복 오답 CTA는 기존 targeted command와 draft reconciliation을 거쳐 세션으로 이동한다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const client = createTestQueryClient()
    cacheDashboardRecommendations(client, [targetedRecommendation])
    const observedQuestionIds: string[] = []
    mockServer.use(
      http.post(
        '*/api/v1/wrong-notes/:questionId/review-session',
        ({ params }) => {
          observedQuestionIds.push(String(params.questionId))
          return HttpResponse.json(
            reviewCenterConformanceFixture.targetedSession,
            {
              status: 201,
              headers: {
                'Cache-Control': 'private, no-store',
                Location: reviewCenterConformanceFixture.targetedLocation,
                'X-Nihongo-Practice-Contract': '2'
              }
            }
          )
        }
      ),
      http.get('*/api/v1/study-sessions/:sessionId/draft-answers', () =>
        HttpResponse.json(practiceFlowConformanceFixture.draft, {
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Nihongo-Practice-Contract': '2'
          }
        })
      )
    )
    const post = vi.spyOn(apiClient, 'post')
    const router = renderDashboard(client)

    await user.click(
      await screen.findByRole('button', {
        name: '이 문제만 복습하기: 반복 오답 1문제 집중 복습'
      })
    )

    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/practice/session/${reviewCenterConformanceFixture.targetedSession.session.id}`
      )
    )
    expect(observedQuestionIds).toEqual([
      reviewCenterConformanceFixture.targetedQuestionId
    ])
    expect(
      post.mock.calls.filter(([url]) => url === '/v1/study-sessions')
    ).toHaveLength(0)
    expect(useAppStore.getState().sessionId).toBe(
      reviewCenterConformanceFixture.targetedSession.session.id
    )
  })

  it.each([
    ['QUESTION_NOT_AVAILABLE', 422],
    ['RESOURCE_NOT_FOUND', 404]
  ] as const)(
    'targeted stale 오류 %s이면 다른 학습으로 바꾸지 않고 insights를 다시 읽는다',
    async (errorCode, status) => {
      const user = userEvent.setup()
      const currentUser = mockDatabase.loginAs('USER')
      useAppStore.getState().setCurrentUser(currentUser)
      const client = createTestQueryClient()
      cacheDashboardRecommendations(client, [targetedRecommendation])
      let targetedRequestCount = 0
      let insightsRequestCount = 0
      mockServer.use(
        http.post('*/api/v1/wrong-notes/:questionId/review-session', () => {
          targetedRequestCount += 1
          return HttpResponse.json(
            {
              code: errorCode,
              message: '현재 복습할 수 없는 문제입니다.',
              requestId: crypto.randomUUID(),
              retryable: false
            },
            { status }
          )
        }),
        http.get('*/api/v1/dashboard/insights', () => {
          insightsRequestCount += 1
          return HttpResponse.json(dashboardInsightsConformanceFixture)
        })
      )
      const router = renderDashboard(client)

      await user.click(
        await screen.findByRole('button', {
          name: '이 문제만 복습하기: 반복 오답 1문제 집중 복습'
        })
      )

      const notice =
        await screen.findByText(/다른 학습으로 자동 변경하지 않았으며/u)
      await vi.waitFor(() => expect(notice).toHaveFocus())
      await vi.waitFor(() => expect(insightsRequestCount).toBe(1))
      expect(targetedRequestCount).toBe(1)
      expect(router.state.location.pathname).toBe('/dashboard')
    }
  )

  it('목표 급수 미설정 setup CTA는 session POST 없이 연습 조건만 연다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    const userWithoutTarget = {
      id: currentUser.id,
      name: currentUser.name,
      role: currentUser.role,
      targetLevel: null
    }
    useAppStore.getState().setCurrentUser(userWithoutTarget)
    const client = createTestQueryClient()
    cacheDashboardRecommendations(
      client,
      [
        {
          rank: 1,
          kind: 'PRACTICE_SETUP',
          reason: { code: 'TARGET_LEVEL_NOT_SET' },
          action: { kind: 'OPEN_PRACTICE_SETUP' }
        }
      ],
      'TARGET_LEVEL_NOT_SET'
    )
    mockServer.use(
      http.get('*/api/v1/me', () =>
        HttpResponse.json({ kind: 'USER', user: userWithoutTarget })
      )
    )
    const post = vi.spyOn(apiClient, 'post')
    const router = renderDashboard(client)

    const setupButton = await screen.findByRole('button', {
      name: '연습 조건 설정 열기: 연습 조건 설정 열기'
    })
    expect(post).not.toHaveBeenCalled()
    await user.click(setupButton)

    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe('/practice')
    )
    expect(post).not.toHaveBeenCalled()
  })
})

import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { toVersionedContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { toCanonicalStudyResultView } from '@app/practice/adapters/studyResultView'
import { mockCanonicalSubmissionV2Operations } from '@mocks/adapters/studySubmissionContractAdapter'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { authQueries } from '@app/login/queries/authQueries'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'
import { PracticeResultPage } from '@app/practice/result/page'
import { getOrCreateResultRetryAttempt } from '@app/practice/resultRetryAttemptStorage'
import { serverStateQueryKeys } from '@libs/serverStateQueryKeys'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'
import { afterEach } from 'vitest'

afterEach(() => {
  act(() => onlineManager.setOnline(true))
})

const createClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })

const createSubmittedSource = (
  questionIds: string[] = ['n5-vocabulary-01']
): {
  principalScope: string
  sourceSessionId: string
} => {
  const user = mockDatabase.loginAs('USER')
  const source = mockDatabase.createStudySession({
    canonicalContractVersion: 2,
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: questionIds.length,
    questionIds
  })
  submitEmptySession(source.session.id)
  return {
    principalScope: getStudyDraftPrincipalScope(user),
    sourceSessionId: source.session.id
  }
}

const submitEmptySession = (sessionId: string): void => {
  const payload = toVersionedContractStudySessionPayload(
    mockDatabase.getCanonicalStudySessionSnapshotRecord(sessionId, null)
  )
  mockDatabase.submitCanonicalStudySession(
    {
      body: {
        answers: payload.questions.map(({ sessionQuestionId }) => ({
          studySessionQuestionId: sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        })),
        durationSec: 0,
        expectedDraftRevision: 0
      },
      contractVersion: 2,
      guestPrincipalId: null,
      idempotencyKey: crypto.randomUUID(),
      sessionId
    },
    mockCanonicalSubmissionV2Operations
  )
}

const createRouter = (sessionId: string) =>
  createMemoryRouter(
    [
      {
        path: '/',
        element: <Outlet />,
        children: [
          {
            path: 'practice/result/:sessionId',
            element: (
              <ProtectedRouteProvider>
                <PracticeResultPage />
              </ProtectedRouteProvider>
            )
          },
          { path: 'practice', element: <p>새 학습 설정</p> }
        ]
      }
    ],
    { initialEntries: [`/practice/result/${sessionId}`] }
  )

const renderResultPage = (
  client: QueryClient,
  router: ReturnType<typeof createRouter>
): ReturnType<typeof render> =>
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

describe('PracticeResultPage retry', () => {
  it('cold offline에서 무한 loading 대신 자동 재확인 상태를 표시한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.setState({ currentUser })
    const client = createClient()
    client.setQueryData(authQueries.currentUser().queryKey, currentUser)
    act(() => onlineManager.setOnline(false))
    const router = createRouter(crypto.randomUUID())

    renderResultPage(client, router)

    expect(
      await screen.findByRole('heading', {
        name: '오프라인에서 학습 결과를 기다리고 있습니다'
      })
    ).toBeVisible()
    expect(
      screen.queryByText('채점 결과를 불러오고 있습니다…')
    ).not.toBeInTheDocument()
    client.clear()
  })

  it('cached 결과 재확인 실패 시 내용을 유지하고 결과 기반 동작을 잠근다', async () => {
    const { sourceSessionId } = createSubmittedSource()
    const client = createClient()
    const router = createRouter(sourceSessionId)
    renderResultPage(client, router)

    expect(
      await screen.findByRole('heading', { name: '학습 결과' })
    ).toBeVisible()
    mockServer.use(
      http.get('*/api/v1/study-sessions/:sessionId/result', () =>
        HttpResponse.json(
          {
            code: 'SERVICE_UNAVAILABLE',
            message: 'temporary result error',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 503 }
        )
      ),
      http.get('*/api/v1/study-sessions/:sessionId', () =>
        HttpResponse.json(
          {
            code: 'SERVICE_UNAVAILABLE',
            message: 'temporary session error',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 503 }
        )
      )
    )

    await act(async () => {
      await Promise.all([
        client.refetchQueries({
          exact: true,
          queryKey: serverStateQueryKeys.study.result(sourceSessionId)
        }),
        client.refetchQueries({
          exact: true,
          queryKey: serverStateQueryKeys.study.session(sourceSessionId)
        })
      ])
    })

    expect(
      await screen.findByText(
        '최신 결과로 갱신하지 못해 마지막으로 확인한 결과를 표시합니다. 다시 확인할 때까지 결과 기반 동작은 잠깁니다.'
      )
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: '학습 결과' })).toBeVisible()
    expect(
      screen.getByRole('button', { name: '오답만 다시 풀기' })
    ).toBeDisabled()
    expect(screen.queryByRole('button', { name: '문제 신고' })).toBeNull()
    client.clear()
  })

  it('cached result에서 bookmark 조회만 offline이면 상태를 알리고 변경을 잠근다', async () => {
    const { sourceSessionId } = createSubmittedSource()
    const client = createClient()
    const firstView = renderResultPage(client, createRouter(sourceSessionId))
    expect(
      await screen.findByRole('heading', { name: '학습 결과' })
    ).toBeVisible()
    firstView.unmount()
    client.removeQueries({ queryKey: bookmarkQueries.allKey() })
    act(() => onlineManager.setOnline(false))

    renderResultPage(client, createRouter(sourceSessionId))

    expect(
      await screen.findByText(
        '오프라인이라 즐겨찾기 상태를 확인할 수 없습니다. 연결되면 자동으로 다시 확인합니다.'
      )
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: '1번 문제 즐겨찾기 추가' })
    ).toBeDisabled()
    client.clear()
  })

  it('guest fresh owner probe 실패 시 cached 결과를 노출하지 않는다', async () => {
    const { sourceSessionId } = createSubmittedSource()
    const resultView = toCanonicalStudyResultView(
      mockDatabase.getCanonicalStudyResult(sourceSessionId, null)
    )
    const sessionView = toCanonicalStudySessionView(
      toVersionedContractStudySessionPayload(
        mockDatabase.getCanonicalStudySessionSnapshotRecord(
          sourceSessionId,
          null
        )
      )
    )
    mockDatabase.logout()
    useAppStore.setState({ currentUser: null })
    const client = createClient()
    client.setQueryData(authQueries.currentUser().queryKey, null)
    client.setQueryData(
      serverStateQueryKeys.study.result(sourceSessionId),
      resultView
    )
    client.setQueryData(
      serverStateQueryKeys.study.session(sourceSessionId),
      sessionView
    )
    mockServer.use(
      http.get('*/api/v1/study-sessions/:sessionId/result', () =>
        HttpResponse.json(
          {
            code: 'SERVICE_UNAVAILABLE',
            message: 'temporary guest result probe error',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 503 }
        )
      ),
      http.get('*/api/v1/study-sessions/:sessionId', () =>
        HttpResponse.json(
          {
            code: 'SERVICE_UNAVAILABLE',
            message: 'temporary guest session probe error',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 503 }
        )
      )
    )
    const router = createRouter(sourceSessionId)

    renderResultPage(client, router)

    expect(
      await screen.findByRole('heading', {
        name: '학습 결과를 불러오지 못했습니다'
      })
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: '학습 결과' })).toBeNull()
    expect(screen.queryByText('「川」の 読み方は どれですか。')).toBeNull()
    client.clear()
  })

  it('guest cached 결과의 fresh owner probe가 offline이면 내용을 노출하지 않는다', async () => {
    const { sourceSessionId } = createSubmittedSource()
    const resultView = toCanonicalStudyResultView(
      mockDatabase.getCanonicalStudyResult(sourceSessionId, null)
    )
    const sessionView = toCanonicalStudySessionView(
      toVersionedContractStudySessionPayload(
        mockDatabase.getCanonicalStudySessionSnapshotRecord(
          sourceSessionId,
          null
        )
      )
    )
    mockDatabase.logout()
    useAppStore.setState({ currentUser: null })
    const client = createClient()
    client.setQueryData(authQueries.currentUser().queryKey, null)
    client.setQueryData(
      serverStateQueryKeys.study.result(sourceSessionId),
      resultView
    )
    client.setQueryData(
      serverStateQueryKeys.study.session(sourceSessionId),
      sessionView
    )
    act(() => onlineManager.setOnline(false))
    const router = createRouter(sourceSessionId)

    renderResultPage(client, router)

    expect(
      await screen.findByRole('heading', {
        name: '오프라인에서 학습 결과를 기다리고 있습니다'
      })
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: '학습 결과' })).toBeNull()
    expect(screen.queryByText('「川」の 読み方は どれですか。')).toBeNull()
    expect(screen.queryByText('채점 결과를 불러오고 있습니다…')).toBeNull()
    client.clear()
  })

  it('payload availability에 따라 한국어 기본 해설과 일본어 선택을 함께 제공한다', async () => {
    const user = userEvent.setup()
    const { sourceSessionId } = createSubmittedSource([
      'n5-vocabulary-01',
      'n5-vocabulary-02'
    ])
    const client = createClient()
    const router = createRouter(sourceSessionId)
    renderResultPage(client, router)

    expect(
      await screen.findByText(
        '「川」는 물이 흐르는 강을 뜻하며 「かわ」라고 읽습니다.'
      )
    ).toHaveAttribute('lang', 'ko')
    expect(screen.getAllByRole('tablist')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: '한국어' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(
      screen.getByText('일본어 해설이 없어 한국어 해설을 표시합니다.')
    ).toBeVisible()
    expect(screen.getByText('「川」の 読み方は どれですか。')).toHaveAttribute(
      'lang',
      'ja'
    )

    await user.click(screen.getByRole('tab', { name: '日本語' }))
    expect(screen.getByText('「川」は「かわ」と読みます。')).toHaveAttribute(
      'lang',
      'ja'
    )
    client.clear()
  })

  it('NO_ELIGIBLE를 focus 가능한 EmptyState로 전환하고 반복 요청을 막는다', async () => {
    const user = userEvent.setup()
    const { sourceSessionId } = createSubmittedSource()
    let requestCount = 0
    mockServer.use(
      http.post('*/api/v1/study-sessions/:sessionId/retry', () => {
        requestCount += 1
        return HttpResponse.json(
          {
            code: 'NO_ELIGIBLE_QUESTIONS',
            message: '현재 다시 풀 수 있는 오답이 없습니다.',
            requestId: crypto.randomUUID(),
            retryable: false
          },
          {
            status: 404,
            headers: { 'Cache-Control': 'private, no-store' }
          }
        )
      })
    )
    const client = createClient()
    const router = createRouter(sourceSessionId)
    renderResultPage(client, router)

    await user.click(
      await screen.findByRole('button', { name: '오답만 다시 풀기' })
    )
    const emptyHeading = await screen.findByRole('heading', {
      name: '현재 다시 풀 수 있는 오답이 없습니다'
    })
    await waitFor(() => expect(emptyHeading).toHaveFocus())
    expect(requestCount).toBe(1)
    expect(
      screen.queryByRole('button', { name: '오답만 다시 풀기' })
    ).not.toBeInTheDocument()
    client.clear()
  })

  it('STUDY_RESULT_NOT_READY refetch 완료 뒤 상태를 정리하고 결과 제목에 focus한다', async () => {
    const user = userEvent.setup()
    const { sourceSessionId } = createSubmittedSource()
    const client = createClient()
    const router = createRouter(sourceSessionId)
    renderResultPage(client, router)
    const retryButton = await screen.findByRole('button', {
      name: '오답만 다시 풀기'
    })
    const resultPayload = mockDatabase.getCanonicalStudyResult(
      sourceSessionId,
      null
    )
    const sessionPayload = toVersionedContractStudySessionPayload(
      mockDatabase.getCanonicalStudySessionSnapshotRecord(sourceSessionId, null)
    )
    let releaseRefetch = (): void => undefined
    const refetchGate = new Promise<void>((resolve) => {
      releaseRefetch = resolve
    })
    let resultRefetchCount = 0
    let sessionRefetchCount = 0
    const canonicalHeaders = {
      'Cache-Control': 'private, no-store',
      'X-Nihongo-Practice-Contract': '2'
    }
    mockServer.use(
      http.post('*/api/v1/study-sessions/:sessionId/retry', () =>
        HttpResponse.json(
          {
            code: 'STUDY_RESULT_NOT_READY',
            message: '제출 결과가 아직 준비되지 않았습니다.',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 409 }
        )
      ),
      http.get('*/api/v1/study-sessions/:sessionId/result', async () => {
        resultRefetchCount += 1
        await refetchGate
        return HttpResponse.json(resultPayload, { headers: canonicalHeaders })
      }),
      http.get('*/api/v1/study-sessions/:sessionId', async () => {
        sessionRefetchCount += 1
        await refetchGate
        return HttpResponse.json(sessionPayload, { headers: canonicalHeaders })
      })
    )

    await user.click(retryButton)
    expect(
      await screen.findByText(
        '원본 학습 결과의 현재 상태를 다시 확인하고 있습니다.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '결과 확인 중…' })).toBeDisabled()
    await waitFor(() => {
      expect(resultRefetchCount).toBe(1)
      expect(sessionRefetchCount).toBe(1)
    })
    await act(async () => releaseRefetch())

    await waitFor(() => {
      expect(
        screen.queryByText(
          '원본 학습 결과의 현재 상태를 다시 확인하고 있습니다.'
        )
      ).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: '학습 결과' })).toHaveFocus()
    })
    expect(
      screen.getByRole('button', { name: '오답만 다시 풀기' })
    ).toBeEnabled()
    client.clear()
  })

  it('STUDY_RESULT_NOT_READY refetch 실패 뒤 일반 재시도로 복구하면 확인 상태를 남기지 않는다', async () => {
    const user = userEvent.setup()
    const { sourceSessionId } = createSubmittedSource()
    const client = createClient()
    const router = createRouter(sourceSessionId)
    renderResultPage(client, router)
    const retryButton = await screen.findByRole('button', {
      name: '오답만 다시 풀기'
    })
    const resultPayload = mockDatabase.getCanonicalStudyResult(
      sourceSessionId,
      null
    )
    const sessionPayload = toVersionedContractStudySessionPayload(
      mockDatabase.getCanonicalStudySessionSnapshotRecord(sourceSessionId, null)
    )
    const canonicalHeaders = {
      'Cache-Control': 'private, no-store',
      'X-Nihongo-Practice-Contract': '2'
    }
    let shouldFailRefetch = true
    mockServer.use(
      http.post('*/api/v1/study-sessions/:sessionId/retry', () =>
        HttpResponse.json(
          {
            code: 'STUDY_RESULT_NOT_READY',
            message: '제출 결과가 아직 준비되지 않았습니다.',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 409 }
        )
      ),
      http.get('*/api/v1/study-sessions/:sessionId/result', () =>
        shouldFailRefetch
          ? HttpResponse.json(
              {
                code: 'SERVICE_UNAVAILABLE',
                message: '잠시 후 다시 시도해 주세요.',
                requestId: crypto.randomUUID(),
                retryable: true
              },
              { status: 503 }
            )
          : HttpResponse.json(resultPayload, { headers: canonicalHeaders })
      ),
      http.get('*/api/v1/study-sessions/:sessionId', () =>
        HttpResponse.json(sessionPayload, { headers: canonicalHeaders })
      )
    )

    await user.click(retryButton)
    expect(
      await screen.findByText(
        '최신 결과로 갱신하지 못해 마지막으로 확인한 결과를 표시합니다. 다시 확인할 때까지 결과 기반 동작은 잠깁니다.'
      )
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: '학습 결과' })).toBeVisible()

    shouldFailRefetch = false
    await user.click(screen.getByRole('button', { name: '다시 시도' }))

    const heading = await screen.findByRole('heading', { name: '학습 결과' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(
      screen.queryByText('원본 학습 결과의 현재 상태를 다시 확인하고 있습니다.')
    ).not.toBeInTheDocument()
    client.clear()
  })

  it('SUBMITTED replay target의 canonical result 경로로 이동하고 다음 retry도 navigation을 막는다', async () => {
    const user = userEvent.setup()
    const { principalScope, sourceSessionId } = createSubmittedSource()
    const client = createClient()
    const router = createRouter(sourceSessionId)
    const rendered = renderResultPage(client, router)
    const firstRetryButton = await screen.findByRole('button', {
      name: '오답만 다시 풀기'
    })
    const attempt = getOrCreateResultRetryAttempt(
      principalScope,
      sourceSessionId
    )
    const target = mockDatabase.createCanonicalResultRetry({
      guestPrincipalId: null,
      idempotencyKey: attempt.idempotencyKey,
      sourceSessionId
    })
    submitEmptySession(target.response.session.id)

    await user.click(firstRetryButton)
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/practice/result/${target.response.session.id}`
      )
    )
    expect(
      await screen.findByRole('button', { name: '오답만 다시 풀기' })
    ).toBeEnabled()
    await waitFor(() => {
      expect(
        client.getQueryState(
          serverStateQueryKeys.study.result(target.response.session.id)
        )?.status
      ).toBe('success')
      expect(
        client.getQueryState(
          serverStateQueryKeys.study.session(target.response.session.id)
        )?.status
      ).toBe('success')
    })

    act(() => onlineManager.setOnline(false))
    await user.click(screen.getByRole('button', { name: '오답만 다시 풀기' }))
    await screen.findByRole('button', { name: '연결 대기 중…' })
    await act(async () => {
      await router.navigate('/practice')
    })
    expect(
      screen.getByRole('heading', {
        name: '오답 재출제 요청을 처리하고 있습니다'
      })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(
      `/practice/result/${target.response.session.id}`
    )

    rendered.unmount()
    client
      .getMutationCache()
      .getAll()
      .forEach((mutation) => client.getMutationCache().remove(mutation))
    act(() => onlineManager.setOnline(true))
    client.clear()
  })

  it('guest fresh owner probe 404를 무한 loading 대신 Not Found로 표시한다', async () => {
    const sessionId = crypto.randomUUID()
    mockServer.use(
      http.get('*/api/v1/study-sessions/:sessionId/result', () =>
        HttpResponse.json(
          {
            code: 'RESOURCE_NOT_FOUND',
            message: '학습 결과를 찾을 수 없습니다.',
            requestId: crypto.randomUUID(),
            retryable: false
          },
          { status: 404 }
        )
      ),
      http.get('*/api/v1/study-sessions/:sessionId', () =>
        HttpResponse.json(
          {
            code: 'RESOURCE_NOT_FOUND',
            message: '학습 세션을 찾을 수 없습니다.',
            requestId: crypto.randomUUID(),
            retryable: false
          },
          { status: 404 }
        )
      )
    )
    const client = createClient()
    const router = createRouter(sessionId)
    renderResultPage(client, router)

    expect(
      await screen.findByRole('heading', {
        name: '학습 결과를 찾을 수 없습니다'
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByText('채점 결과를 불러오고 있습니다.')
    ).not.toBeInTheDocument()
    client.clear()
  })
})

import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { getStudyResultV1 } from '@api/study/getStudyResultV1'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { submitStudySessionCommand } from '@app/practice/commands/submitStudySessionCommand'
import { PracticeSessionPage } from '@app/practice/session/page'
import {
  clearSubmissionAttempt,
  getOrCreateCanonicalSubmissionAttempt,
  getSubmissionAttemptStorageKey
} from '@app/practice/submissionAttempt'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { cachedSessionStorage } from '@libs/storage'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

vi.mock('@libs/apiMode', () => ({
  apiMode: 'real',
  isMockApiMode: false,
  isRealApiMode: true
}))

const createClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })

const createSubmittedFixture = async () => {
  const user = mockDatabase.loginAs('USER')
  useAppStore.getState().setCurrentUser(user)
  const created = await createStudySessionV1({
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 1
  })
  const session = toCanonicalStudySessionView(created)
  await submitStudySessionCommand({
    sessionId: session.session.id,
    input: { answers: [], durationSec: 3 },
    getCachedSession: () => session
  })
  const rawResult = await getStudyResultV1(session.session.id)
  clearSubmissionAttempt(session.session.id)
  return { rawResult, rawSession: created, session }
}

const renderSession = (
  client: QueryClient,
  sessionId: string
): {
  router: ReturnType<typeof createMemoryRouter>
  unmount: () => void
} => {
  const router = createMemoryRouter(
    [
      { path: '/practice', element: <p>학습 설정 화면</p> },
      {
        path: '/practice/session/:sessionId',
        element: (
          <ProtectedRouteProvider>
            <PracticeSessionPage />
          </ProtectedRouteProvider>
        )
      },
      {
        path: '/practice/result/:sessionId',
        element: <p>캐시된 단일 결과</p>
      }
    ],
    {
      initialEntries: ['/practice', `/practice/session/${sessionId}`],
      initialIndex: 1
    }
  )
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  return { router, unmount: view.unmount }
}

describe('real canonical submission recovery UI', () => {
  it('keeps the session editable when durable attempt storage fails before transport', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const created = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const session = toCanonicalStudySessionView(created)
    const client = createClient()
    client.setQueryData(
      serverStateQueryKeys.study.session(session.session.id),
      session
    )
    useAppStore
      .getState()
      .beginPractice(session.session.id, session.session.startedAt)
    let requestCount = 0
    mockServer.use(
      http.post('*/api/v1/study-sessions/:sessionId/submission', () => {
        requestCount += 1
        return HttpResponse.json({}, { status: 500 })
      })
    )
    const writeSessionStorage =
      cachedSessionStorage.setItem.bind(cachedSessionStorage)
    const attemptStorageKey = getSubmissionAttemptStorageKey(session.session.id)
    vi.spyOn(cachedSessionStorage, 'setItem').mockImplementation(
      (key, value) =>
        key === attemptStorageKey ? false : writeSessionStorage(key, value)
    )
    const view = renderSession(client, session.session.id)
    const question = session.questions[0]
    const firstOption = await screen.findByRole('radio', {
      name: `1. ${question.options[0].text}`
    })
    const secondOption = screen.getByRole('radio', {
      name: `2. ${question.options[1].text}`
    })

    await user.click(firstOption)
    await user.click(screen.getByRole('button', { name: '답안 제출' }))
    await user.click(screen.getByRole('button', { name: '제출하고 결과 보기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '제출 요청이 처리되지 않았습니다'
    )
    expect(requestCount).toBe(0)
    expect(
      window.sessionStorage.getItem(
        getSubmissionAttemptStorageKey(session.session.id)
      )
    ).toBeNull()
    expect(screen.getByRole('button', { name: '대화상자 닫기' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '계속 풀기' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '계속 풀기' }))
    await user.click(secondOption)
    expect(secondOption).toBeChecked()
    await act(async () => view.router.navigate(-1))
    expect(await screen.findByText('학습 설정 화면')).toBeInTheDocument()
  })

  it('replays one frozen key/body after two losses, reload, and manual recovery', async () => {
    const user = userEvent.setup()
    const { rawResult, session } = await createSubmittedFixture()
    const client = createClient()
    client.setQueryData(
      serverStateQueryKeys.study.session(session.session.id),
      session
    )
    useAppStore
      .getState()
      .beginPractice(session.session.id, session.session.startedAt)
    const requestBodies: unknown[] = []
    const idempotencyKeys: Array<string | null> = []
    let requestCount = 0
    mockServer.use(
      http.post(
        '*/api/v1/study-sessions/:sessionId/submission',
        async ({ request }) => {
          requestCount += 1
          requestBodies.push(await request.clone().json())
          idempotencyKeys.push(request.headers.get('Idempotency-Key'))
          if (requestCount <= 2) {
            return HttpResponse.json(
              { code: 'SERVICE_UNAVAILABLE', message: 'response lost' },
              { status: 503 }
            )
          }
          return HttpResponse.json(rawResult, { status: 201 })
        }
      )
    )
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const firstView = renderSession(client, session.session.id)
    const question = session.questions[0]
    const firstOption = await screen.findByRole('radio', {
      name: `1. ${question.options[0].text}`
    })
    const secondOption = screen.getByRole('radio', {
      name: `2. ${question.options[1].text}`
    })

    await user.click(firstOption)
    await user.click(screen.getByRole('button', { name: '답안 제출' }))
    await user.click(screen.getByRole('button', { name: '제출하고 결과 보기' }))

    await waitFor(() => expect(requestCount).toBe(2), { timeout: 3_000 })
    expect(
      await screen.findByRole('alert', undefined, { timeout: 3_000 })
    ).toHaveTextContent('동일 답안으로 다시 시도')
    expect(
      window.sessionStorage.getItem(
        getSubmissionAttemptStorageKey(session.session.id)
      )
    ).not.toBeNull()

    const dialog = screen.getByRole('dialog')
    expect(screen.getByRole('button', { name: '대화상자 닫기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '계속 풀기' })).toBeDisabled()
    expect(secondOption).toBeDisabled()
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    fireEvent.click(dialog)
    fireEvent.keyDown(window, { key: '2' })
    await act(async () => firstView.router.navigate(-1))
    expect(screen.queryByText('학습 설정 화면')).not.toBeInTheDocument()
    expect(useAppStore.getState().selectedAnswers[question.id]).toBe(
      question.options[0].id
    )

    fireEvent(window, new Event('offline'))
    expect(await screen.findByText(/오프라인 상태입니다/)).toHaveAttribute(
      'role',
      'status'
    )
    fireEvent(window, new Event('online'))
    expect(
      await screen.findByText(/네트워크 연결이 복구되었습니다/)
    ).toHaveAttribute('aria-live', 'polite')

    firstView.unmount()
    expect(removeListener).toHaveBeenCalledWith('offline', expect.any(Function))
    expect(removeListener).toHaveBeenCalledWith('online', expect.any(Function))
    useAppStore.getState().selectAnswer(question.id, question.options[1].id)

    renderSession(client, session.session.id)
    expect(
      await screen.findByRole('heading', {
        name: '답안을 제출하시겠습니까?'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: `1. ${question.options[0].text}` })
    ).toBeChecked()
    expect(
      screen.getByRole('radio', { name: `2. ${question.options[1].text}` })
    ).not.toBeChecked()
    expect(
      screen.getByRole('radio', { name: `2. ${question.options[1].text}` })
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '제출하고 결과 보기' }))

    expect(await screen.findByText('캐시된 단일 결과')).toBeInTheDocument()
    expect(requestCount).toBe(3)
    expect(new Set(idempotencyKeys).size).toBe(1)
    expect(idempotencyKeys[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(requestBodies[1]).toEqual(requestBodies[0])
    expect(requestBodies[2]).toEqual(requestBodies[0])
    expect(
      window.sessionStorage.getItem(
        getSubmissionAttemptStorageKey(session.session.id)
      )
    ).toBeNull()
    removeListener.mockRestore()
  }, 10_000)

  it('shows frozen recovery when session reload fails, then refetches and replays', async () => {
    const user = userEvent.setup()
    const { rawResult, rawSession, session } = await createSubmittedFixture()
    const question = session.questions[0]
    const selectedOptionId = question.options[0].id
    const attempt = getOrCreateCanonicalSubmissionAttempt(
      session.session.id,
      {
        answers: [
          {
            questionId: question.id,
            selectedOptionId,
            elapsedSec: 2
          }
        ],
        durationSec: 2
      },
      session
    )
    const client = createClient()
    let sessionRequestCount = 0
    let replayBody: unknown
    let replayKey: string | null = null
    mockServer.use(
      http.get('*/api/v1/study-sessions/:sessionId', () => {
        sessionRequestCount += 1
        return HttpResponse.json(rawSession)
      }),
      http.post(
        '*/api/v1/study-sessions/:sessionId/submission',
        async ({ request }) => {
          replayBody = await request.clone().json()
          replayKey = request.headers.get('Idempotency-Key')
          return HttpResponse.json(rawResult, { status: 201 })
        }
      )
    )
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false
    })
    onlineManager.setOnline(false)
    fireEvent(window, new Event('offline'))
    const view = renderSession(client, session.session.id)

    expect(
      await screen.findByRole('heading', {
        name: '이전 제출 결과 확인이 필요합니다'
      })
    ).toBeInTheDocument()
    await act(async () => view.router.navigate(-1))
    expect(screen.queryByText('학습 설정 화면')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('오프라인 상태')
    expect(
      screen.getByRole('button', { name: '세션 상태 다시 확인' })
    ).toBeEnabled()
    expect(sessionRequestCount).toBe(0)

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true
    })
    fireEvent(window, new Event('online'))
    onlineManager.setOnline(true)

    expect(
      await screen.findByRole('heading', {
        name: '답안을 제출하시겠습니까?'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: `1. ${question.options[0].text}` })
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '제출하고 결과 보기' }))

    expect(await screen.findByText('캐시된 단일 결과')).toBeInTheDocument()
    expect(sessionRequestCount).toBe(1)
    expect(replayKey).toBe(attempt.idempotencyKey)
    expect(replayBody).toEqual(attempt.canonicalBody)
  })
})

import {
  MutationCache,
  MutationObserver,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import {
  act,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { apiClient, isApiError } from '@api/config'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudyResultV1 } from '@api/study/getStudyResultV1'
import { saveStudyDraftAnswers } from '@api/study/saveStudyDraftAnswers'
import { bookmarkRoutes } from '@app/bookmark/router'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'
import { adminQuestionRoutes } from '@app/admin-question/router'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import {
  assertCurrentCreateStudySessionAction,
  studySessionMutations,
  studySessionQueries
} from '@app/practice/queries/studySessionQueries'
import { submitStudySessionCommand } from '@app/practice/commands/submitStudySessionCommand'
import { submitStudySessionV2Command } from '@app/practice/commands/submitStudySessionV2Command'
import { useSubmitStudySession } from '@app/practice/hooks/useSubmitStudySession'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { commitCanonicalAuth } from '@app/login/authSession'
import {
  clearSubmissionAttempt,
  getOrCreateCanonicalSubmissionAttempt,
  getSubmissionAttemptStorageKey
} from '@app/practice/submissionAttempt'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { wrongNoteMutations } from '@app/wrong-note/queries/wrongNoteQueries'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { demoUsers } from '@mocks/data/users'
import {
  advanceAuthTransitionEpoch,
  AuthTransitionSupersededError
} from '@libs/authTransitionFence'
import { emitApiError, subscribeApiError } from '@libs/errorBus'
import { useAppStore } from '@store/index'
import { cachedSessionStorage } from '@libs/storage'
import { mockServer } from '@/test/server'

vi.mock('@libs/apiMode', () => ({
  apiMode: 'real',
  isMockApiMode: false,
  isRealApiMode: true
}))

const createCanonicalSessionView = (): StudySessionView => {
  const sessionId = crypto.randomUUID()
  const questionId = crypto.randomUUID()

  return {
    session: {
      id: sessionId,
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      status: 'IN_PROGRESS',
      startedAt: '2026-08-16T00:00:00.000Z',
      expiresAt: '2026-08-17T00:00:00.000Z',
      submittedAt: null,
      durationSec: null,
      practiceContractVersion: 1
    },
    questions: [
      {
        id: questionId,
        sessionQuestionId: crypto.randomUUID(),
        questionVersionId: crypto.randomUUID(),
        ordinal: 1,
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        passage: null,
        questionText: '인증 전환 격리 문제',
        options: [1, 2, 3, 4].map((value) => ({
          id: crypto.randomUUID(),
          label: String(value) as '1' | '2' | '3' | '4',
          text: `${value}번 보기`
        })),
        difficulty: 'NORMAL',
        tags: ['격리']
      }
    ],
    requestedCount: 1,
    actualCount: 1,
    usedFallback: false,
    fallbackReason: null
  }
}

const createSubmittedCanonicalFixture = async (): Promise<{
  client: QueryClient
  rawResult: Awaited<ReturnType<typeof getStudyResultV1>>
  session: StudySessionView
}> => {
  mockDatabase.loginAs('USER')
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })
  const created = await createStudySessionV1({
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 1
  })
  const session = await client.fetchQuery(
    studySessionQueries.session(created.session.id)
  )
  await submitStudySessionCommand({
    sessionId: session.session.id,
    input: { answers: [], durationSec: 3 },
    getCachedSession: () => session
  })
  const rawResult = await getStudyResultV1(session.session.id)
  clearSubmissionAttempt(session.session.id)
  client.setQueryData(
    serverStateQueryKeys.study.session(session.session.id),
    session
  )

  return { client, rawResult, session }
}

describe('real API Query and feature cutover', () => {
  it('uses canonical RANDOM/read/submit/result/wrong-note/dashboard transports', async () => {
    mockDatabase.loginAs('USER')
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })
    const createObserver = new MutationObserver(
      client,
      studySessionMutations.createSession()
    )
    const created = await createObserver.mutate({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 2
    })
    const session = await client.fetchQuery(
      studySessionQueries.session(created.session.id)
    )
    client.setQueryData(
      serverStateQueryKeys.study.session(session.session.id),
      session
    )
    const answers = session.questions.map((question, index) => {
      if (!question.sessionQuestionId) {
        throw new Error('v2 세션 문제 ID가 없습니다.')
      }

      return {
        studySessionQuestionId: question.sessionQuestionId,
        selectedOptionId: null,
        elapsedSec: index === 0 ? 11 : 0
      }
    })
    const savedDraft = await saveStudyDraftAnswers(
      session.session.id,
      {
        expectedRevision: 0,
        currentOrdinal: 1,
        answers
      },
      crypto.randomUUID()
    )
    const result = await submitStudySessionV2Command({
      sessionId: session.session.id,
      input: {
        answers: savedDraft.data.answers,
        durationSec: 11,
        expectedDraftRevision: savedDraft.data.revision
      }
    })
    const wrongNotes = await client.fetchQuery(
      wrongNoteQueries.list({ page: 1, pageSize: 20, sort: 'RECENT' })
    )
    const detail = await client.fetchQuery(
      wrongNoteQueries.detail(wrongNotes.items[0]?.questionId ?? '')
    )
    const dashboard = await client.fetchQuery(dashboardQueries.stats())

    expect(session.questions).toHaveLength(2)
    expect(
      session.questions.every((question) => question.sessionQuestionId !== null)
    ).toBe(true)
    expect(result.incorrectCount).toBe(2)
    expect(wrongNotes.items).toHaveLength(2)
    expect(detail).toMatchObject({
      memo: null,
      currentReviewQuestionVersionId: null,
      canRetry: false,
      canUpdateMemo: false
    })
    expect(dashboard.totalAnsweredCount).toBe(2)
  })

  it('keeps out-of-scope writes closed while canonical Bookmark reads use v1', async () => {
    mockDatabase.loginAs('USER')
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })
    const postSpy = vi.spyOn(apiClient, 'post')
    const getSpy = vi.spyOn(apiClient, 'get')
    const putSpy = vi.spyOn(apiClient, 'put')
    const createObserver = new MutationObserver(
      client,
      studySessionMutations.createSession()
    )
    const memoObserver = new MutationObserver(
      client,
      wrongNoteMutations.updateMemo(crypto.randomUUID())
    )

    await expect(
      createObserver.mutate({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'WRONG_NOTE',
        count: 1,
        questionIds: [crypto.randomUUID()]
      })
    ).rejects.toThrow('문항 ID 직접 선택은 Slice 5 전까지 지원하지 않습니다.')
    await expect(client.fetchQuery(bookmarkQueries.list())).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0
    })
    await expect(memoObserver.mutate({ memo: '메모' })).rejects.toThrow(
      '메모 수정'
    )

    expect(postSpy).not.toHaveBeenCalled()
    expect(getSpy).toHaveBeenCalledWith('/v1/bookmarks?page=1&pageSize=20', {
      params: undefined
    })
    expect(putSpy).not.toHaveBeenCalled()
  })

  it('mounts canonical Bookmark while keeping admin management unavailable', async () => {
    mockDatabase.loginAs('USER')
    const get = vi.spyOn(apiClient, 'get')
    const post = vi.spyOn(apiClient, 'post')
    const put = vi.spyOn(apiClient, 'put')
    const del = vi.spyOn(apiClient, 'delete')
    const bookmarkRouter = createMemoryRouter(bookmarkRoutes, {
      initialEntries: ['/bookmarks']
    })
    const bookmarkClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const { unmount } = render(
      <QueryClientProvider client={bookmarkClient}>
        <RouterProvider router={bookmarkRouter} />
      </QueryClientProvider>
    )

    expect(
      await screen.findByRole('heading', {
        name: '즐겨찾기 문제'
      })
    ).toBeInTheDocument()
    expect(
      await screen.findByText('저장한 문제가 없습니다')
    ).toBeInTheDocument()
    unmount()

    const adminRouter = createMemoryRouter(adminQuestionRoutes, {
      initialEntries: ['/admin/questions']
    })
    render(<RouterProvider router={adminRouter} />)

    expect(
      await screen.findByRole('heading', {
        name: '문제 관리는 아직 사용할 수 없습니다'
      })
    ).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/v1/bookmarks?page=1&pageSize=20', {
      params: undefined
    })
    expect(post).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('drops a delayed previous-user submission after an auth transition', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })
    const session = createCanonicalSessionView()
    const sessionId = session.session.id
    let requestCount = 0
    let releaseResponse: (() => void) | undefined
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    mockServer.use(
      http.post('*/api/v1/study-sessions/:sessionId/submission', async () => {
        requestCount += 1
        await responseGate
        return HttpResponse.json({ stale: true })
      })
    )
    const currentUser = mockDatabase.loginAs('USER')
    const nextUser = demoUsers.find(({ role }) => role === 'ADMIN')
    expect(nextUser).toBeDefined()
    if (!nextUser) {
      return
    }
    useAppStore.getState().setCurrentUser(currentUser)
    client.setQueryData(serverStateQueryKeys.study.session(sessionId), session)
    const navigate = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useSubmitStudySession(sessionId), {
      wrapper
    })

    act(() => {
      result.current.mutate(
        { answers: [], durationSec: 3 },
        { onSuccess: navigate }
      )
    })
    await waitFor(() => expect(requestCount).toBe(1))
    expect(
      window.sessionStorage.getItem(getSubmissionAttemptStorageKey(sessionId))
    ).not.toBeNull()

    await commitCanonicalAuth(client, nextUser, {
      forceClear: true,
      forcePracticeReset: true
    })
    releaseResponse?.()

    await waitFor(() =>
      expect(result.current.error).toBeInstanceOf(AuthTransitionSupersededError)
    )
    expect(useAppStore.getState().currentUser?.id).toBe(nextUser.id)
    expect(
      client.getQueryData(serverStateQueryKeys.study.result(sessionId))
    ).toBeUndefined()
    expect(
      window.sessionStorage.getItem(getSubmissionAttemptStorageKey(sessionId))
    ).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
    expect(requestCount).toBe(1)
  })

  it('does not start a retry HTTP attempt after the submission action epoch is superseded', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })
    const session = createCanonicalSessionView()
    const sessionId = session.session.id
    let requestCount = 0
    mockServer.use(
      http.post('*/api/v1/study-sessions/:sessionId/submission', () => {
        requestCount += 1
        return HttpResponse.json(
          { code: 'SERVICE_UNAVAILABLE', message: 'retry later' },
          { status: 503 }
        )
      })
    )
    client.setQueryData(serverStateQueryKeys.study.session(sessionId), session)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useSubmitStudySession(sessionId), {
      wrapper
    })

    act(() => {
      result.current.mutate({ answers: [], durationSec: 3 })
    })
    await waitFor(() => expect(requestCount).toBe(1))
    advanceAuthTransitionEpoch()

    await waitFor(
      () =>
        expect(result.current.error).toBeInstanceOf(
          AuthTransitionSupersededError
        ),
      { timeout: 2_500 }
    )
    expect(requestCount).toBe(1)
    expect(
      window.sessionStorage.getItem(getSubmissionAttemptStorageKey(sessionId))
    ).not.toBeNull()
  })

  it('does not POST when a submission attempt cannot be durably persisted', async () => {
    const session = createCanonicalSessionView()
    const post = vi.spyOn(apiClient, 'post')
    vi.spyOn(cachedSessionStorage, 'setItem').mockReturnValueOnce(false)

    await expect(
      submitStudySessionCommand({
        sessionId: session.session.id,
        input: { answers: [], durationSec: 3 },
        getCachedSession: () => session
      })
    ).rejects.toThrow('답안을 전송하지 않았습니다')
    expect(post).not.toHaveBeenCalled()
  })

  it('preserves an older ambiguous attempt when a different session is created', async () => {
    mockDatabase.loginAs('USER')
    const oldSession = createCanonicalSessionView()
    getOrCreateCanonicalSubmissionAttempt(
      oldSession.session.id,
      { answers: [], durationSec: 3 },
      oldSession
    )
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })
    const createObserver = new MutationObserver(
      client,
      studySessionMutations.createSession()
    )

    await createObserver.mutate({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })

    expect(
      window.sessionStorage.getItem(
        getSubmissionAttemptStorageKey(oldSession.session.id)
      )
    ).not.toBeNull()
  })

  it.each(['MALFORMED_201', 'ALREADY_SUBMITTED_409'] as const)(
    'reconciles %s through the canonical result GET before success callbacks',
    async (scenario) => {
      const { client, rawResult, session } =
        await createSubmittedCanonicalFixture()
      let submitCount = 0
      mockServer.use(
        http.post('*/api/v1/study-sessions/:sessionId/submission', () => {
          submitCount += 1
          return scenario === 'MALFORMED_201'
            ? HttpResponse.json({ malformed: true }, { status: 201 })
            : HttpResponse.json(
                {
                  code: 'SESSION_ALREADY_SUBMITTED',
                  message: 'already submitted'
                },
                { status: 409 }
              )
        }),
        http.get('*/api/v1/study-sessions/:sessionId/result', () =>
          HttpResponse.json(rawResult)
        )
      )
      const navigate = vi.fn()
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
      const { result } = renderHook(
        () => useSubmitStudySession(session.session.id),
        { wrapper }
      )

      act(() => {
        result.current.mutate(
          { answers: [], durationSec: 8 },
          { onSuccess: navigate }
        )
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(submitCount).toBe(1)
      expect(navigate).toHaveBeenCalledTimes(1)
      expect(
        client.getQueryData(
          serverStateQueryKeys.study.result(session.session.id)
        )
      ).toBeDefined()
      expect(
        window.sessionStorage.getItem(
          getSubmissionAttemptStorageKey(session.session.id)
        )
      ).toBeNull()
    }
  )

  it('preserves the frozen attempt when both submit and result responses are malformed', async () => {
    const { client, session } = await createSubmittedCanonicalFixture()
    mockServer.use(
      http.post('*/api/v1/study-sessions/:sessionId/submission', () =>
        HttpResponse.json({ malformed: true }, { status: 201 })
      ),
      http.get('*/api/v1/study-sessions/:sessionId/result', () =>
        HttpResponse.json({ malformed: true })
      )
    )
    const navigate = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => useSubmitStudySession(session.session.id),
      { wrapper }
    )

    act(() => {
      result.current.mutate(
        { answers: [], durationSec: 8 },
        { onSuccess: navigate }
      )
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(navigate).not.toHaveBeenCalled()
    expect(
      client.getQueryData(serverStateQueryKeys.study.result(session.session.id))
    ).toBeUndefined()
    expect(
      window.sessionStorage.getItem(
        getSubmissionAttemptStorageKey(session.session.id)
      )
    ).not.toBeNull()
  })

  it.each(['MALFORMED_201', 'ALREADY_SUBMITTED_409'] as const)(
    'preserves %s as ambiguous when result reconciliation returns 404',
    async (scenario) => {
      const { client, session } = await createSubmittedCanonicalFixture()
      mockServer.use(
        http.post('*/api/v1/study-sessions/:sessionId/submission', () =>
          scenario === 'MALFORMED_201'
            ? HttpResponse.json({ malformed: true }, { status: 201 })
            : HttpResponse.json(
                {
                  code: 'SESSION_ALREADY_SUBMITTED',
                  message: 'already submitted'
                },
                { status: 409 }
              )
        ),
        http.get('*/api/v1/study-sessions/:sessionId/result', () =>
          HttpResponse.json(
            { code: 'RESOURCE_NOT_FOUND', message: 'result not found' },
            { status: 404 }
          )
        )
      )
      const navigate = vi.fn()
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
      const { result } = renderHook(
        () => useSubmitStudySession(session.session.id),
        { wrapper }
      )

      act(() => {
        result.current.mutate(
          { answers: [], durationSec: 8 },
          { onSuccess: navigate }
        )
      })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(navigate).not.toHaveBeenCalled()
      expect(
        client.getQueryData(
          serverStateQueryKeys.study.result(session.session.id)
        )
      ).toBeUndefined()
      expect(
        window.sessionStorage.getItem(
          getSubmissionAttemptStorageKey(session.session.id)
        )
      ).not.toBeNull()
    }
  )

  it('keeps an auth-superseded result reconciliation silent and isolated', async () => {
    const { rawResult, session } = await createSubmittedCanonicalFixture()
    let releaseResult: (() => void) | undefined
    let resultRequestCount = 0
    const resultGate = new Promise<void>((resolve) => {
      releaseResult = resolve
    })
    mockServer.use(
      http.post('*/api/v1/study-sessions/:sessionId/submission', () =>
        HttpResponse.json({ malformed: true }, { status: 201 })
      ),
      http.get('*/api/v1/study-sessions/:sessionId/result', async () => {
        resultRequestCount += 1
        await resultGate
        return HttpResponse.json(rawResult)
      })
    )
    const client = new QueryClient({
      mutationCache: new MutationCache({ onError: emitApiError }),
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })
    client.setQueryData(
      serverStateQueryKeys.study.session(session.session.id),
      session
    )
    const currentUser = mockDatabase.getCurrentUser()
    const nextUser = demoUsers.find(({ role }) => role === 'ADMIN')
    expect(currentUser).not.toBeNull()
    expect(nextUser).toBeDefined()
    if (!currentUser || !nextUser) {
      return
    }
    useAppStore.getState().setCurrentUser(currentUser)
    const notify = vi.fn()
    const unsubscribe = subscribeApiError(notify)
    const navigate = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => useSubmitStudySession(session.session.id),
      { wrapper }
    )

    act(() => {
      result.current.mutate(
        { answers: [], durationSec: 8 },
        { onSuccess: navigate }
      )
    })
    await waitFor(() => expect(resultRequestCount).toBe(1))

    await commitCanonicalAuth(client, nextUser, {
      forceClear: true,
      forcePracticeReset: true
    })
    releaseResult?.()

    await waitFor(() =>
      expect(result.current.error).toBeInstanceOf(AuthTransitionSupersededError)
    )
    expect(notify).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(
      client.getQueryData(serverStateQueryKeys.study.result(session.session.id))
    ).toBeUndefined()
    unsubscribe()
  })

  it('preserves auth classification when result reconciliation returns 401', async () => {
    const { client, session } = await createSubmittedCanonicalFixture()
    mockServer.use(
      http.post('*/api/v1/study-sessions/:sessionId/submission', () =>
        HttpResponse.json(
          {
            code: 'SESSION_ALREADY_SUBMITTED',
            message: 'already submitted'
          },
          { status: 409 }
        )
      ),
      http.get('*/api/v1/study-sessions/:sessionId/result', () =>
        HttpResponse.json(
          { code: 'AUTH_SESSION_EXPIRED', message: 'sign in again' },
          { status: 401 }
        )
      )
    )
    const navigate = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => useSubmitStudySession(session.session.id),
      { wrapper }
    )

    act(() => {
      result.current.mutate(
        { answers: [], durationSec: 8 },
        { onSuccess: navigate }
      )
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(isApiError(result.current.error)).toBe(true)
    if (isApiError(result.current.error)) {
      expect(result.current.error.isAuthError).toBe(true)
      expect(result.current.error.code).toBe('AUTH_SESSION_EXPIRED')
    }
    expect(navigate).not.toHaveBeenCalled()
    expect(
      client.getQueryData(serverStateQueryKeys.study.result(session.session.id))
    ).toBeUndefined()
  })

  it('blocks create success callbacks in the HTTP-to-callback auth transition gap', async () => {
    mockDatabase.loginAs('USER')
    const rawCreated = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    let releaseSuccessCallbacks: (() => void) | undefined
    let callbackGateCount = 0
    const callbackGate = new Promise<void>((resolve) => {
      releaseSuccessCallbacks = resolve
    })
    const client = new QueryClient({
      mutationCache: new MutationCache({
        onSuccess: async () => {
          callbackGateCount += 1
          await callbackGate
        }
      }),
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })
    mockServer.use(
      http.post('*/api/v1/study-sessions', () =>
        HttpResponse.json(rawCreated.data, {
          status: 201,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Nihongo-Practice-Contract': '2'
          }
        })
      )
    )
    const currentUser = mockDatabase.getCurrentUser()
    const nextUser = demoUsers.find(({ role }) => role === 'ADMIN')
    expect(currentUser).not.toBeNull()
    expect(nextUser).toBeDefined()
    if (!currentUser || !nextUser) {
      return
    }
    useAppStore.getState().setCurrentUser(currentUser)
    const navigate = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useCreateStudySession(), { wrapper })

    act(() => {
      result.current.mutate(
        {
          level: 'N5',
          subject: 'VOCABULARY',
          mode: 'RANDOM',
          count: 1
        },
        {
          onSuccess: ({ session }, input) => {
            assertCurrentCreateStudySessionAction(input)
            useAppStore.getState().beginPractice(session.id, session.startedAt)
            navigate()
          }
        }
      )
    })
    await waitFor(() => expect(callbackGateCount).toBe(1))

    await commitCanonicalAuth(client, nextUser, {
      forceClear: true,
      forcePracticeReset: true
    })
    releaseSuccessCallbacks?.()

    await waitFor(() =>
      expect(result.current.error).toBeInstanceOf(AuthTransitionSupersededError)
    )
    expect(useAppStore.getState().currentUser?.id).toBe(nextUser.id)
    expect(useAppStore.getState().sessionId).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })
})

import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach } from 'vitest'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { submitStudySessionV1 } from '@api/study/submitStudySessionV1'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'
import { PracticeSessionPage } from '@app/practice/session/page'
import { authQueries } from '@app/login/queries/authQueries'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { serverStateQueryKeys } from '@libs/serverStateQueryKeys'
import { queryClient } from '@libs/queryClient'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'
import { appI18n } from '@/i18n/config'

afterEach(() => {
  act(() => onlineManager.setOnline(true))
})

describe('PracticeSessionPage', () => {
  it('cold offline에서 무한 loading 대신 자동 재확인 상태를 표시한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.setState({ currentUser })
    queryClient.setQueryData(authQueries.currentUser().queryKey, currentUser)
    act(() => onlineManager.setOnline(false))
    const sessionId = crypto.randomUUID()
    const router = createMemoryRouter(
      [
        {
          path: '/practice/session/:sessionId',
          element: (
            <ProtectedRouteProvider>
              <PracticeSessionPage />
            </ProtectedRouteProvider>
          )
        }
      ],
      { initialEntries: [`/practice/session/${sessionId}`] }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    expect(
      await screen.findByText(
        '오프라인입니다. 연결되면 학습 세션을 자동으로 다시 확인합니다.'
      )
    ).toBeVisible()
    expect(
      screen.queryByText('문제를 준비하고 있습니다…')
    ).not.toBeInTheDocument()
  })

  it('cached session 재확인 실패 시 문제를 유지하되 답 변경과 제출을 잠근다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.setState({ currentUser })
    queryClient.setQueryData(authQueries.currentUser().queryKey, currentUser)
    const sessionPayload = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionView = toCanonicalStudySessionView(sessionPayload)
    const queryKey = serverStateQueryKeys.study.session(
      sessionPayload.session.id
    )
    queryClient.setQueryData(queryKey, sessionView)
    await queryClient.invalidateQueries({
      exact: true,
      queryKey,
      refetchType: 'none'
    })
    mockServer.use(
      http.get('*/api/v1/study-sessions/:sessionId', () =>
        HttpResponse.json(
          {
            code: 'SERVICE_UNAVAILABLE',
            message: 'temporary error',
            requestId: crypto.randomUUID(),
            retryable: false
          },
          { status: 503 }
        )
      )
    )
    const router = createMemoryRouter(
      [
        {
          path: '/practice/session/:sessionId',
          element: (
            <ProtectedRouteProvider>
              <PracticeSessionPage />
            </ProtectedRouteProvider>
          )
        }
      ],
      { initialEntries: [`/practice/session/${sessionPayload.session.id}`] }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    expect(
      await screen.findByText(
        '학습 세션의 최신 상태를 확인하지 못했습니다. 현재 문제와 답안은 유지되며 다시 확인할 때까지 변경하거나 제출할 수 없습니다.'
      )
    ).toBeVisible()
    expect(
      screen.getByText(
        (_content, element) =>
          element?.getAttribute('lang') === 'ja' &&
          element.textContent === sessionView.questions[0]?.questionText
      )
    ).toHaveAttribute('lang', 'ja')
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled()
    }
    expect(screen.getByRole('button', { name: '답안 제출' })).toBeDisabled()
  })

  it('cached session에서 bookmark 조회만 offline이면 상태를 알리고 변경을 잠근다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.setState({ currentUser })
    const created = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    useAppStore
      .getState()
      .beginPractice(created.data.session.id, created.data.session.startedAt)
    const createRouter = () =>
      createMemoryRouter(
        [
          {
            path: '/practice/session/:sessionId',
            element: (
              <ProtectedRouteProvider>
                <PracticeSessionPage />
              </ProtectedRouteProvider>
            )
          }
        ],
        { initialEntries: [`/practice/session/${created.data.session.id}`] }
      )
    const firstView = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={createRouter()} />
      </QueryClientProvider>
    )
    const question = created.data.questions[0]?.question
    expect(question).toBeDefined()
    if (!question) return
    const findQuestionText = () =>
      screen.findByText(
        (_content, element) =>
          element?.getAttribute('lang') === 'ja' &&
          element.textContent === question.questionText
      )
    expect(await findQuestionText()).toBeVisible()
    firstView.unmount()
    queryClient.removeQueries({ queryKey: bookmarkQueries.allKey() })
    act(() => onlineManager.setOnline(false))

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={createRouter()} />
      </QueryClientProvider>
    )

    expect(await findQuestionText()).toBeVisible()
    expect(
      screen.getByText(
        '오프라인이라 즐겨찾기 상태를 확인할 수 없습니다. 연결되면 자동으로 다시 확인합니다.'
      )
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: '1번 문제 즐겨찾기 추가' })
    ).toBeDisabled()
  })

  it('guest cached session의 fresh owner probe가 offline이면 문제를 노출하지 않는다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.setState({ currentUser })
    const sessionPayload = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionView = toCanonicalStudySessionView(sessionPayload)
    mockDatabase.logout()
    useAppStore.setState({ currentUser: null })
    queryClient.setQueryData(authQueries.currentUser().queryKey, null)
    queryClient.setQueryData(
      serverStateQueryKeys.study.session(sessionPayload.session.id),
      sessionView
    )
    act(() => onlineManager.setOnline(false))
    const router = createMemoryRouter(
      [
        {
          path: '/practice/session/:sessionId',
          element: (
            <ProtectedRouteProvider>
              <PracticeSessionPage />
            </ProtectedRouteProvider>
          )
        }
      ],
      { initialEntries: [`/practice/session/${sessionPayload.session.id}`] }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    expect(
      await screen.findByText(
        '오프라인입니다. 연결되면 학습 세션을 자동으로 다시 확인합니다.'
      )
    ).toBeVisible()
    expect(
      screen.queryByText(sessionView.questions[0]?.questionText ?? '')
    ).toBeNull()
    expect(
      screen.queryByText('게스트 세션 소유권을 확인하고 있습니다…')
    ).toBeNull()
  })

  it('숫자 키와 클릭 선택이 같은 답안 상태와 radio 상태를 갱신한다', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ currentUser: mockDatabase.loginAs('USER') })
    const sessionPayload = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 5
    })
    const sessionView = toCanonicalStudySessionView(sessionPayload)
    const firstQuestion = sessionView.questions[0]

    expect(firstQuestion).toBeDefined()
    if (!firstQuestion) {
      return
    }

    useAppStore
      .getState()
      .beginPractice(
        sessionPayload.session.id,
        sessionPayload.session.startedAt
      )

    const router = createMemoryRouter(
      [
        {
          path: '/practice/session/:sessionId',
          element: (
            <ProtectedRouteProvider>
              <PracticeSessionPage />
            </ProtectedRouteProvider>
          )
        }
      ],
      {
        initialEntries: [`/practice/session/${sessionPayload.session.id}`]
      }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    const firstOption = await screen.findByRole('radio', {
      name: `1. ${firstQuestion.options[0]?.text}`
    })
    const secondOption = screen.getByRole('radio', {
      name: `2. ${firstQuestion.options[1]?.text}`
    })

    fireEvent.keyDown(window, { key: '2' })
    expect(secondOption).toBeChecked()
    expect(useAppStore.getState().selectedAnswers[firstQuestion.id]).toBe(
      firstQuestion.options[1]?.id
    )

    await user.click(firstOption)
    expect(firstOption).toBeChecked()
    expect(secondOption).not.toBeChecked()
    expect(useAppStore.getState().selectedAnswers[firstQuestion.id]).toBe(
      firstQuestion.options[0]?.id
    )

    fireEvent.keyDown(firstOption, { key: '2' })
    expect(secondOption).toBeChecked()
    expect(useAppStore.getState().selectedAnswers[firstQuestion.id]).toBe(
      firstQuestion.options[1]?.id
    )

    await act(async () => appI18n.changeLanguage('ja'))

    expect(
      screen.getByRole('heading', { name: /1番の問題/u })
    ).toBeInTheDocument()
    expect(secondOption).toBeChecked()
    expect(useAppStore.getState().selectedAnswers[firstQuestion.id]).toBe(
      firstQuestion.options[1]?.id
    )
  })

  it('V2 이전·다음 단축키가 첫·마지막 경계를 지키고 현재 문제 제목에 focus한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.setState({ currentUser })
    queryClient.setQueryData(authQueries.currentUser().queryKey, currentUser)
    const created = await createStudySessionV2({
      level: 'N5',
      subject: 'READING',
      mode: 'RANDOM',
      count: 3
    })
    expect(created.data.session.actualCount).toBe(3)
    useAppStore
      .getState()
      .beginPractice(created.data.session.id, created.data.session.startedAt)
    const router = createMemoryRouter(
      [
        {
          path: '/practice/session/:sessionId',
          element: (
            <ProtectedRouteProvider>
              <PracticeSessionPage />
            </ProtectedRouteProvider>
          )
        }
      ],
      { initialEntries: [`/practice/session/${created.data.session.id}`] }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    const expectFocusedQuestion = async (ordinal: number) => {
      const heading = await screen.findByRole('heading', {
        level: 1,
        name: new RegExp(`^${ordinal}번 문제`, 'u')
      })
      await waitFor(() => expect(heading).toHaveFocus())
      return heading
    }

    const firstHeading = await expectFocusedQuestion(1)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(firstHeading).toHaveFocus()
    expect(firstHeading).toHaveAccessibleName(/^1번 문제/u)

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await expectFocusedQuestion(2)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    await expectFocusedQuestion(1)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await expectFocusedQuestion(2)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    const lastHeading = await expectFocusedQuestion(3)

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(lastHeading).toHaveFocus()
    expect(lastHeading).toHaveAccessibleName(/^3번 문제/u)
  })

  it('독해 지문 scroll region을 keyboard로 진입하고 다음 control로 빠져나간다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.setState({ currentUser })
    queryClient.setQueryData(authQueries.currentUser().queryKey, currentUser)
    const sessionPayload = await createStudySessionV1({
      level: 'N5',
      subject: 'READING',
      mode: 'RANDOM',
      count: 1
    })
    useAppStore
      .getState()
      .beginPractice(
        sessionPayload.session.id,
        sessionPayload.session.startedAt
      )
    const router = createMemoryRouter(
      [
        {
          path: '/practice/session/:sessionId',
          element: (
            <ProtectedRouteProvider>
              <PracticeSessionPage />
            </ProtectedRouteProvider>
          )
        }
      ],
      { initialEntries: [`/practice/session/${sessionPayload.session.id}`] }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    const passage = await screen.findByRole('article', {
      name: '독해 지문'
    })
    expect(passage).toHaveClass('scroll-mt-24')
    await user.tab({ shift: true })
    expect(passage).toHaveFocus()

    await user.keyboard('{PageDown}')
    await user.tab()
    expect(screen.getAllByRole('radio')[0]).toHaveFocus()
  })

  it('제출 단축키로 Dialog를 열고 열린 동안 배경 단축키를 비활성화한다', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ currentUser: mockDatabase.loginAs('USER') })
    const sessionPayload = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const question = toCanonicalStudySessionView(sessionPayload).questions[0]

    expect(question).toBeDefined()
    if (!question) {
      return
    }

    useAppStore
      .getState()
      .beginPractice(
        sessionPayload.session.id,
        sessionPayload.session.startedAt
      )
    const router = createMemoryRouter(
      [
        {
          path: '/practice/session/:sessionId',
          element: (
            <ProtectedRouteProvider>
              <PracticeSessionPage />
            </ProtectedRouteProvider>
          )
        }
      ],
      { initialEntries: [`/practice/session/${sessionPayload.session.id}`] }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    const firstOption = await screen.findByRole('radio', {
      name: `1. ${question.options[0]?.text}`
    })
    const secondOption = screen.getByRole('radio', {
      name: `2. ${question.options[1]?.text}`
    })
    await user.click(firstOption)
    const submitButton = screen.getByRole('button', { name: '답안 제출' })
    expect(submitButton).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Enter Meta+Enter'
    )
    fireEvent.keyDown(window, { ctrlKey: true, key: 'Enter' })
    expect(
      screen.getByRole('heading', { name: '답안을 제출하시겠습니까?' })
    ).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '2' })
    expect(firstOption).toBeChecked()
    expect(secondOption).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: '대화상자 닫기' }))
    await waitFor(() => expect(submitButton).toHaveFocus())
  })

  it('제출 전송 중에는 네 가지 닫기 경로와 답 변경·뒤로가기를 막고 한 결과로 수렴한다', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ currentUser: mockDatabase.loginAs('USER') })
    const sessionPayload = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionView = toCanonicalStudySessionView(sessionPayload)
    const question = sessionView.questions[0]
    expect(question).toBeDefined()
    if (!question) {
      return
    }
    const successfulResult = await submitStudySessionV1(
      sessionPayload.session.id,
      {
        answers: [
          {
            studySessionQuestionId:
              sessionPayload.questions[0]?.sessionQuestionId ?? '',
            selectedOptionId: null,
            elapsedSec: 5
          }
        ],
        durationSec: 5
      },
      crypto.randomUUID()
    )
    queryClient.setQueryData(
      serverStateQueryKeys.study.session(sessionPayload.session.id),
      sessionView
    )
    useAppStore
      .getState()
      .beginPractice(
        sessionPayload.session.id,
        sessionPayload.session.startedAt
      )
    let requestCount = 0
    let releaseResponse: (() => void) | undefined
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    mockServer.use(
      http.post('*/api/v1/study-sessions/:sessionId/submission', async () => {
        requestCount += 1
        await responseGate
        return HttpResponse.json(successfulResult)
      })
    )
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
          element: <p>단일 결과 화면</p>
        }
      ],
      {
        initialEntries: [
          '/practice',
          `/practice/session/${sessionPayload.session.id}`
        ],
        initialIndex: 1
      }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    const firstOption = await screen.findByRole('radio', {
      name: `1. ${question.options[0]?.text}`
    })
    const secondOption = screen.getByRole('radio', {
      name: `2. ${question.options[1]?.text}`
    })
    await user.click(firstOption)
    await user.click(screen.getByRole('button', { name: '답안 제출' }))
    await user.click(screen.getByRole('button', { name: '제출하고 결과 보기' }))
    await waitFor(() => expect(requestCount).toBe(1))

    const dialog = screen.getByRole('dialog')
    const closeButton = screen.getByRole('button', {
      name: '대화상자 닫기'
    })
    const continueButton = screen.getByRole('button', { name: '계속 풀기' })
    expect(closeButton).toBeDisabled()
    expect(continueButton).toBeDisabled()
    expect(secondOption).toBeDisabled()

    fireEvent.click(closeButton)
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    fireEvent.click(dialog)
    fireEvent.click(continueButton)
    fireEvent.click(secondOption)
    fireEvent.keyDown(window, { key: '2' })
    await act(async () => {
      await router.navigate(-1)
    })

    expect(
      screen.getByRole('heading', { name: '답안을 제출하시겠습니까?' })
    ).toBeInTheDocument()
    expect(useAppStore.getState().selectedAnswers[question.id]).toBe(
      question.options[0]?.id
    )
    expect(screen.queryByText('학습 설정 화면')).not.toBeInTheDocument()

    await act(async () => {
      releaseResponse?.()
    })

    expect(await screen.findByText('단일 결과 화면')).toBeInTheDocument()
    expect(requestCount).toBe(1)
    expect(
      queryClient.getQueryCache().findAll({
        exact: true,
        queryKey: serverStateQueryKeys.study.result(sessionPayload.session.id)
      })
    ).toHaveLength(1)
  })

  it('이미 제출한 세션으로 돌아오면 결과 경로로 이동한다', async () => {
    useAppStore.setState({ currentUser: mockDatabase.loginAs('USER') })
    const sessionPayload = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    await submitStudySessionV1(
      sessionPayload.session.id,
      {
        answers: [
          {
            studySessionQuestionId:
              sessionPayload.questions[0]?.sessionQuestionId ?? '',
            selectedOptionId: null,
            elapsedSec: 5
          }
        ],
        durationSec: 5
      },
      crypto.randomUUID()
    )
    const router = createMemoryRouter(
      [
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
          element: <p>제출 결과 도착</p>
        }
      ],
      { initialEntries: [`/practice/session/${sessionPayload.session.id}`] }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    expect(await screen.findByText('제출 결과 도착')).toBeInTheDocument()
  })

  it('만료된 세션에서는 단축키와 제출 제어가 모두 비활성화된다', async () => {
    const sessionId = crypto.randomUUID()
    const questionId = crypto.randomUUID()
    const session: StudySessionView = {
      session: {
        id: sessionId,
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        status: 'EXPIRED',
        startedAt: '2026-08-15T00:00:00.000Z',
        expiresAt: '2026-08-16T00:00:00.000Z',
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
          questionText: '만료된 문제',
          options: [1, 2, 3, 4].map((value) => ({
            id: crypto.randomUUID(),
            label: String(value) as '1' | '2' | '3' | '4',
            text: `${value}번 보기`
          })),
          difficulty: 'NORMAL',
          tags: ['읽기']
        }
      ],
      requestedCount: 1,
      actualCount: 1,
      usedFallback: false,
      fallbackReason: null
    }
    queryClient.setQueryData(
      serverStateQueryKeys.study.session(sessionId),
      session
    )
    useAppStore.setState({ currentUser: mockDatabase.loginAs('USER') })
    const router = createMemoryRouter(
      [
        {
          path: '/practice/session/:sessionId',
          element: (
            <ProtectedRouteProvider>
              <PracticeSessionPage />
            </ProtectedRouteProvider>
          )
        }
      ],
      { initialEntries: [`/practice/session/${sessionId}`] }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    expect(
      await screen.findByRole('heading', { name: '만료된 학습 세션입니다' })
    ).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '1' })
    expect(useAppStore.getState().selectedAnswers).toEqual({})
    expect(
      screen.queryByRole('button', { name: '답안 제출' })
    ).not.toBeInTheDocument()
  })
})

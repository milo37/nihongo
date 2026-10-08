import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { authQueries } from '@app/login/queries/authQueries'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { WrongNoteDetailPage } from '@app/wrong-note/detail/page'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import {
  getOrCreateTargetedReviewAttempt,
  readTargetedReviewAttempt
} from '@app/wrong-note/targetedReviewAttemptStorage'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { mockCanonicalSubmissionV2Operations } from '@mocks/adapters/studySubmissionContractAdapter'
import { toVersionedContractStudySessionPayload } from '@mocks/adapters/studySessionContractAdapter'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

type PreparedWrongNote = {
  questionId: string
  sourceQuestionId: string
  userId: string
}

const createDeferred = (): {
  promise: Promise<void>
  release: () => void
} => {
  let release: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release: () => release?.() }
}

const prepareWrongNote = (
  sourceQuestionId = 'n5-vocabulary-01'
): PreparedWrongNote => {
  const user = mockDatabase.loginAs('USER')
  const created = mockDatabase.createStudySession({
    canonicalContractVersion: 2,
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 1,
    questionIds: [sourceQuestionId]
  })
  const payload = toVersionedContractStudySessionPayload(
    mockDatabase.getCanonicalStudySessionSnapshotRecord(
      created.session.id,
      null
    )
  )
  const question = payload.questions[0]
  if (!question) {
    throw new Error('오답 상세 통합 fixture의 문제가 필요합니다.')
  }
  mockDatabase.submitCanonicalStudySession(
    {
      body: {
        answers: [
          {
            studySessionQuestionId: question.sessionQuestionId,
            selectedOptionId: null,
            elapsedSec: 0
          }
        ],
        durationSec: 0,
        expectedDraftRevision: 0
      },
      contractVersion: 2,
      guestPrincipalId: null,
      idempotencyKey: crypto.randomUUID(),
      sessionId: created.session.id
    },
    mockCanonicalSubmissionV2Operations
  )

  return {
    questionId: question.question.id,
    sourceQuestionId,
    userId: user.id
  }
}

const archiveQuestion = (sourceQuestionId: string): void => {
  const question = mockDatabase.getAdminQuestion(sourceQuestionId)
  const correctOption = question.options.find(({ isCorrect }) => isCorrect)
  if (!correctOption) {
    throw new Error('archive fixture의 정답 선택지가 필요합니다.')
  }
  mockDatabase.updateQuestion(sourceQuestionId, {
    level: question.level,
    subject: question.subject,
    questionType: question.questionType,
    passage: question.passage,
    questionText: question.questionText,
    options: question.options.map(({ id, label, text }) => ({
      id,
      label,
      text
    })),
    correctOptionId: correctOption.id,
    explanationKo: question.explanationKo,
    explanationJa: question.explanationJa,
    difficulty: question.difficulty,
    tags: question.tags,
    status: 'DRAFT'
  })
}

const renderDetailPage = (
  questionId: string,
  search = ''
): {
  client: QueryClient
  router: ReturnType<typeof createMemoryRouter>
} => {
  const currentUser = mockDatabase.getCurrentUser()
  if (!currentUser) {
    throw new Error('오답 상세 통합 fixture의 로그인 사용자가 필요합니다.')
  }
  useAppStore.getState().setCurrentUser(currentUser)
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })
  client.setQueryData(authQueries.currentUser().queryKey, currentUser)
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <ProtectedRouteProvider>
            <Outlet />
          </ProtectedRouteProvider>
        ),
        children: [
          {
            path: 'wrong-notes/:questionId',
            element: <WrongNoteDetailPage />
          },
          {
            path: 'practice/session/:sessionId',
            element: <h1>단일 복습 세션</h1>
          },
          {
            path: 'practice/result/:sessionId',
            element: <h1>단일 복습 결과</h1>
          },
          { path: 'dashboard', element: <h1>학습 대시보드</h1> }
        ]
      }
    ],
    { initialEntries: [`/wrong-notes/${questionId}${search}`] }
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { client, router }
}

describe('WrongNoteDetailPage integration', () => {
  it('loads detail, memo, and history together and starts one current review only after memo is clean', async () => {
    const user = userEvent.setup()
    const prepared = prepareWrongNote()
    const { client, router } = renderDetailPage(
      prepared.questionId,
      '?returnTo=%2Fdashboard'
    )

    expect(
      await screen.findByRole('heading', { name: '마지막 오답 문제 상세' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '학습 대시보드로 돌아가기' })
    ).toHaveAttribute('href', '/dashboard')
    const memo = await screen.findByRole('textbox', { name: '나의 메모' })
    expect(
      await screen.findByRole('heading', { name: '복습 타임라인' })
    ).toBeInTheDocument()

    await user.type(memo, '먼저 저장할 메모')
    expect(
      screen.getByRole('button', { name: '이 문제만 다시 풀기' })
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '변경 취소' }))
    await user.click(
      screen.getByRole('button', { name: '이 문제만 다시 풀기' })
    )

    expect(
      await screen.findByRole('heading', { name: '단일 복습 세션' })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toMatch(
      /^\/practice\/session\/[0-9a-f-]{36}$/u
    )
    expect(
      readTargetedReviewAttempt(
        getStudyDraftPrincipalScope(mockDatabase.getCurrentUser()),
        prepared.questionId
      )
    ).toBeNull()
    client.clear()
  })

  it('recovers the same submitted target after archival without reading a terminal draft', async () => {
    const user = userEvent.setup()
    const prepared = prepareWrongNote()
    const principalScope = getStudyDraftPrincipalScope(
      mockDatabase.getCurrentUser()
    )
    const attempt = getOrCreateTargetedReviewAttempt(
      principalScope,
      prepared.questionId
    )
    const targeted = mockDatabase.createCanonicalTargetedReview({
      userId: prepared.userId,
      questionId: prepared.questionId,
      idempotencyKey: attempt.idempotencyKey
    })
    mockDatabase.submitCanonicalStudySession(
      {
        body: {
          answers: targeted.response.questions.map(({ sessionQuestionId }) => ({
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
        sessionId: targeted.response.session.id
      },
      mockCanonicalSubmissionV2Operations
    )
    archiveQuestion(prepared.sourceQuestionId)
    let draftReadCount = 0
    mockServer.use(
      http.get('*/api/v1/study-sessions/:sessionId/draft', () => {
        draftReadCount += 1
        return HttpResponse.json(
          { message: 'terminal draft must not be read' },
          { status: 500 }
        )
      })
    )
    const { client, router } = renderDetailPage(prepared.questionId)

    expect(
      await screen.findByRole('button', { name: '기존 단일 복습 복구' })
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: '기존 단일 복습 복구' })
    )

    expect(
      await screen.findByRole('heading', { name: '단일 복습 결과' })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(
      `/practice/result/${targeted.response.session.id}`
    )
    expect(draftReadCount).toBe(0)
    expect(
      readTargetedReviewAttempt(principalScope, prepared.questionId)
    ).toBeNull()
    client.clear()
  })

  it('announces an archived cancelled target after durable recovery clears its attempt', async () => {
    const user = userEvent.setup()
    const prepared = prepareWrongNote()
    const principalScope = getStudyDraftPrincipalScope(
      mockDatabase.getCurrentUser()
    )
    const attempt = getOrCreateTargetedReviewAttempt(
      principalScope,
      prepared.questionId
    )
    const targeted = mockDatabase.createCanonicalTargetedReview({
      userId: prepared.userId,
      questionId: prepared.questionId,
      idempotencyKey: attempt.idempotencyKey
    })
    mockDatabase.cancelCanonicalStudySession(targeted.response.session.id, null)
    archiveQuestion(prepared.sourceQuestionId)
    const { client } = renderDetailPage(prepared.questionId)

    await user.click(
      await screen.findByRole('button', { name: '기존 단일 복습 복구' })
    )

    expect(
      await screen.findByText(
        '이전에 만든 단일 복습 세션이 종료됐습니다. 보관된 문제에서는 새 단일 복습을 시작할 수 없습니다.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '이전에 만든 단일 복습 세션이 종료됐습니다. 보관된 문제에서는 새 단일 복습을 시작할 수 없습니다.'
      )
    ).toHaveAttribute('aria-live', 'polite')
    expect(
      screen.queryByRole('button', { name: '기존 단일 복습 복구' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '이 문제만 다시 풀기' })
    ).not.toBeInTheDocument()
    expect(
      readTargetedReviewAttempt(principalScope, prepared.questionId)
    ).toBeNull()
    client.clear()
  })

  it('retains dirty memo input when a cached detail background refresh fails', async () => {
    const user = userEvent.setup()
    const prepared = prepareWrongNote()
    const { client } = renderDetailPage(prepared.questionId)
    expect(
      await screen.findByRole('heading', { name: '마지막 오답 문제 상세' })
    ).toBeInTheDocument()
    const memo = await screen.findByRole('textbox', { name: '나의 메모' })
    await user.type(memo, '상세 갱신 실패에도 남는 입력')

    const started = createDeferred()
    const responseGate = createDeferred()
    mockServer.use(
      http.get(`*/api/v1/wrong-notes/${prepared.questionId}`, async () => {
        started.release()
        await responseGate.promise
        return HttpResponse.json(
          {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'temporary detail error',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 500 }
        )
      })
    )
    void client.invalidateQueries({
      queryKey: wrongNoteQueries.detail(prepared.questionId).queryKey,
      exact: true
    })
    await started.promise
    await act(async () => responseGate.release())

    expect(
      await screen.findByText(/상세의 최신 상태를 확인하지 못했습니다/u)
    ).toBeInTheDocument()
    expect(memo).toHaveValue('상세 갱신 실패에도 남는 입력')
    expect(
      screen.getByRole('button', { name: '이 문제만 다시 풀기' })
    ).toBeDisabled()
    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
    client.clear()
  })
})

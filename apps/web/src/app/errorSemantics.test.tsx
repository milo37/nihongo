import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { EditAdminQuestionPage } from '@app/admin-question/edit/page'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'
import { PracticeResultPage } from '@app/practice/result/page'
import { studyQueries } from '@app/practice/queries/studyQueries'
import { WrongNoteDetailPage } from '@app/wrong-note/detail/page'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import { authQueries } from '@app/login/queries/authQueries'
import { Layout } from '@app/layout'
import { AuthErrorHandlerProvider } from '@provider/AuthErrorHandlerProvider'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { ToastProvider } from '@common/components/Toast'
import { mockServer } from '@/test/server'

const renderPage = (
  path: string,
  routePath: string,
  element: React.ReactNode,
  prepareClient?: (client: QueryClient) => void
): void => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })
  client.setQueryData(
    authQueries.currentUser().queryKey,
    mockDatabase.getCurrentUser()
  )
  prepareClient?.(client)
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <ProtectedRouteProvider>
            <AuthErrorHandlerProvider />
            <Layout />
          </ProtectedRouteProvider>
        ),
        children: [{ path: routePath.replace(/^\//, ''), element }]
      }
    ],
    { initialEntries: [path] }
  )

  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  )
}

describe('detail page error semantics', () => {
  it('오답 상세는 실제 404와 retryable 오류를 구분하고 retry한다', async () => {
    const user = userEvent.setup()
    mockDatabase.loginAs('USER')
    let requestCount = 0
    mockServer.use(
      http.get('*/api/wrong-note/missing', () => {
        requestCount += 1
        if (requestCount === 1) {
          return HttpResponse.json(
            { message: 'temporary error' },
            { status: 500 }
          )
        }
        return HttpResponse.json({ message: 'not found' }, { status: 404 })
      })
    )

    renderPage(
      '/wrong-notes/missing',
      '/wrong-notes/:questionId',
      <WrongNoteDetailPage />
    )

    expect(
      await screen.findByRole('heading', {
        name: '오답 상세를 불러오지 못했습니다'
      })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(
      await screen.findByRole('heading', {
        name: '오답을 찾을 수 없습니다'
      })
    ).toBeInTheDocument()
    expect(requestCount).toBe(2)
  })

  it('관리자 수정은 서버 오류를 구분하고 retry 후 폼을 복구한다', async () => {
    const user = userEvent.setup()
    mockDatabase.loginAs('ADMIN')
    const questionId = 'n5-vocabulary-01'
    let requestCount = 0
    mockServer.use(
      http.get(`*/api/admin/question/${questionId}`, () => {
        requestCount += 1
        if (requestCount === 1) {
          return HttpResponse.json({ message: 'server error' }, { status: 500 })
        }
        return HttpResponse.json(mockDatabase.getAdminQuestion(questionId))
      })
    )

    renderPage(
      `/admin/questions/${questionId}/edit`,
      '/admin/questions/:questionId/edit',
      <EditAdminQuestionPage />,
      (client) => {
        const queryKey = adminQuestionQueries.detail(questionId).queryKey
        client.setQueryData(queryKey, mockDatabase.getAdminQuestion(questionId))
        void client.invalidateQueries({ queryKey, exact: true })
      }
    )

    expect(
      await screen.findByRole('heading', {
        name: '문제 정보를 불러오지 못했습니다'
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', {
        name: '수정할 문제를 찾을 수 없습니다'
      })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    const editHeading = await screen.findByRole('heading', {
      name: '문제 수정'
    })
    await vi.waitFor(() => expect(editHeading).toHaveFocus())
    expect(requestCount).toBe(2)
  })

  it('오답 상세 retry 성공 후 복구된 제목으로 포커스를 이동한다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    const sessionPayload = mockDatabase.createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const question = mockDatabase.getAdminQuestion(
      sessionPayload.questions[0].id
    )
    const incorrectOption = question.options.find((option) => !option.isCorrect)
    expect(incorrectOption).toBeDefined()
    if (!incorrectOption) {
      return
    }
    mockDatabase.submitStudySession({
      sessionId: sessionPayload.session.id,
      answers: [
        {
          questionId: question.id,
          selectedOptionId: incorrectOption.id,
          elapsedSec: 2
        }
      ],
      durationSec: 2
    })
    const detail = mockDatabase.getWrongNote(currentUser.id, question.id)
    let requestCount = 0
    mockServer.use(
      http.get(`*/api/wrong-note/${question.id}`, () => {
        requestCount += 1
        return requestCount === 1
          ? HttpResponse.json({ message: 'temporary error' }, { status: 500 })
          : HttpResponse.json(detail)
      })
    )

    renderPage(
      `/wrong-notes/${question.id}`,
      '/wrong-notes/:questionId',
      <WrongNoteDetailPage />,
      (client) => {
        const queryKey = wrongNoteQueries.detail(question.id).queryKey
        client.setQueryData(queryKey, detail)
        void client.invalidateQueries({ queryKey, exact: true })
      }
    )

    await screen.findByRole('heading', {
      name: '오답 상세를 불러오지 못했습니다'
    })
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    const detailHeading = await screen.findByRole('heading', {
      name: '오답 상세'
    })
    await vi.waitFor(() => expect(detailHeading).toHaveFocus())
    expect(requestCount).toBe(2)
  })

  it('관리자 수정은 실제 404만 Not Found로 표시한다', async () => {
    mockDatabase.loginAs('ADMIN')
    mockServer.use(
      http.get('*/api/admin/question/missing', () =>
        HttpResponse.json({ message: 'not found' }, { status: 404 })
      )
    )

    renderPage(
      '/admin/questions/missing/edit',
      '/admin/questions/:questionId/edit',
      <EditAdminQuestionPage />
    )

    expect(
      await screen.findByRole('heading', {
        name: '수정할 문제를 찾을 수 없습니다'
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '다시 시도' })
    ).not.toBeInTheDocument()
  })

  it('결과는 실제 404만 Not Found로 표시한다', async () => {
    mockServer.use(
      http.get('*/api/study/session/missing/result', () =>
        HttpResponse.json({ message: 'not found' }, { status: 404 })
      ),
      http.get('*/api/study/session/missing', () =>
        HttpResponse.json({ message: 'not found' }, { status: 404 })
      )
    )

    renderPage(
      '/practice/result/missing',
      '/practice/result/:sessionId',
      <PracticeResultPage />
    )

    expect(
      await screen.findByRole('heading', {
        name: '학습 결과를 찾을 수 없습니다'
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '다시 시도' })
    ).not.toBeInTheDocument()
  })

  it('결과 retry 후 두 요청이 모두 준비된 시점에 요약 제목을 포커스한다', async () => {
    const user = userEvent.setup()
    const sessionPayload = mockDatabase.createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const question = mockDatabase.getAdminQuestion(
      sessionPayload.questions[0].id
    )
    const result = mockDatabase.submitStudySession({
      sessionId: sessionPayload.session.id,
      answers: [
        {
          questionId: question.id,
          selectedOptionId: question.options[0].id,
          elapsedSec: 2
        }
      ],
      durationSec: 2
    })
    let resultRequestCount = 0
    let sessionRequestCount = 0

    mockServer.use(
      http.get(
        `*/api/study/session/${sessionPayload.session.id}/result`,
        () => {
          resultRequestCount += 1
          return resultRequestCount === 1
            ? HttpResponse.json(
                { message: 'temporary result error' },
                { status: 500 }
              )
            : HttpResponse.json(result)
        }
      ),
      http.get(`*/api/study/session/${sessionPayload.session.id}`, async () => {
        sessionRequestCount += 1
        if (sessionRequestCount === 1) {
          return HttpResponse.json(
            { message: 'temporary session error' },
            { status: 500 }
          )
        }
        await delay(50)
        return HttpResponse.json(sessionPayload)
      })
    )

    renderPage(
      `/practice/result/${sessionPayload.session.id}`,
      '/practice/result/:sessionId',
      <PracticeResultPage />,
      (client) => {
        const resultKey = studyQueries.result(
          sessionPayload.session.id
        ).queryKey
        const sessionKey = studyQueries.session(
          sessionPayload.session.id
        ).queryKey
        client.setQueryData(resultKey, result)
        client.setQueryData(sessionKey, sessionPayload)
        void client.invalidateQueries({ queryKey: resultKey, exact: true })
        void client.invalidateQueries({ queryKey: sessionKey, exact: true })
      }
    )

    expect(
      await screen.findByRole('heading', {
        name: '학습 결과를 불러오지 못했습니다'
      })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다시 시도' }))

    const summaryHeading = await screen.findByRole('heading', {
      name: '학습 결과'
    })
    await vi.waitFor(() => expect(summaryHeading).toHaveFocus())
    expect(resultRequestCount).toBe(2)
    expect(sessionRequestCount).toBe(2)
  })

  it('결과의 한 요청이 retryable이면 다른 요청의 404보다 재시도를 우선한다', async () => {
    mockServer.use(
      http.get('*/api/study/session/mixed/result', () =>
        HttpResponse.json({ message: 'server error' }, { status: 500 })
      ),
      http.get('*/api/study/session/mixed', () =>
        HttpResponse.json({ message: 'not found' }, { status: 404 })
      )
    )

    renderPage(
      '/practice/result/mixed',
      '/practice/result/:sessionId',
      <PracticeResultPage />
    )

    expect(
      await screen.findByRole('heading', {
        name: '학습 결과를 불러오지 못했습니다'
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', {
        name: '학습 결과를 찾을 수 없습니다'
      })
    ).not.toBeInTheDocument()
  })
})

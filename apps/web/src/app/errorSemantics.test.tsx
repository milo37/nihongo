import { commitCanonicalAuth } from '@app/login/authSession'
import { appI18n } from '@/i18n/config'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { submitStudySessionV1 } from '@api/study/submitStudySessionV1'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { I18nProvider } from '@provider/I18nProvider'
import { getWrongNoteV1 } from '@api/wrong-note/getWrongNoteV1'
import { toCanonicalWrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { EditAdminQuestionPage } from '@app/admin-question/edit/page'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'
import { PracticeResultPage } from '@app/practice/result/page'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudySessionV2 } from '@api/study/getStudySessionV2'
import { getStudyDraftAnswers } from '@api/study/getStudyDraftAnswers'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import { getStudyResultV1 } from '@api/study/getStudyResultV1'
import { WrongNoteDetailPage } from '@app/wrong-note/detail/page'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import { authQueries } from '@app/login/queries/authQueries'
import { Layout } from '@app/layout'
import { AuthErrorHandlerProvider } from '@provider/AuthErrorHandlerProvider'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { ToastProvider } from '@common/components/Toast'
import { mockServer } from '@/test/server'

const renderPage = async (
  path: string,
  routePath: string,
  element: React.ReactNode,
  prepareClient?: (client: QueryClient) => void
): Promise<void> => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })
  const canonicalUser = await client.fetchQuery(authQueries.currentUser())
  await commitCanonicalAuth(client, canonicalUser)
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
      <I18nProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
}

describe('detail page error semantics', () => {
  it('오답 상세는 실제 404와 retryable 오류를 구분하고 retry한다', async () => {
    const user = userEvent.setup()
    mockDatabase.loginAs('USER')
    const missingId = '00000000-0000-4000-8000-ffffffffffff'
    let requestCount = 0
    mockServer.use(
      http.get(`*/api/v1/wrong-notes/${missingId}`, () => {
        requestCount += 1
        if (requestCount === 1) {
          return HttpResponse.json(
            {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'temporary error',
              requestId: crypto.randomUUID(),
              retryable: true
            },
            { status: 500 }
          )
        }
        return HttpResponse.json(
          {
            code: 'RESOURCE_NOT_FOUND',
            message: 'not found',
            requestId: crypto.randomUUID(),
            retryable: false
          },
          { status: 404 }
        )
      })
    )

    await renderPage(
      `/wrong-notes/${missingId}`,
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

    await renderPage(
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
    mockDatabase.loginAs('USER')
    const sessionPayload = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const question = toCanonicalStudySessionView(sessionPayload).questions[0]
    if (!question || !question.sessionQuestionId) {
      throw new Error('A canonical session-question fixture is required.')
    }
    await submitStudySessionV1(
      sessionPayload.session.id,
      {
        answers: [
          {
            studySessionQuestionId: question.sessionQuestionId,
            selectedOptionId: null,
            elapsedSec: 2
          }
        ],
        durationSec: 2
      },
      crypto.randomUUID()
    )
    const payload = await getWrongNoteV1(question.id)
    const detail = toCanonicalWrongNoteDetailView(payload)
    let requestCount = 0
    mockServer.use(
      http.get(`*/api/v1/wrong-notes/${question.id}`, () => {
        requestCount += 1
        return requestCount === 1
          ? HttpResponse.json(
              {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'temporary error',
                requestId: crypto.randomUUID(),
                retryable: true
              },
              { status: 500 }
            )
          : HttpResponse.json(payload)
      })
    )

    await renderPage(
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
      name: '상세의 최신 상태를 확인하지 못했습니다. 표시 중인 내용과 작성 중인 메모는 유지됩니다.'
    })
    await user.click(
      screen.getByRole('button', {
        name: '\uC0C1\uC138 \uB2E4\uC2DC \uD655\uC778'
      })
    )
    const detailHeading = await screen.findByRole('heading', {
      name: appI18n.t('wrongNote:integration.detail')
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

    await renderPage(
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
    mockDatabase.loginAs('USER')
    const missingId = '00000000-0000-4000-8000-ffffffffffff'
    const paths: string[] = []
    const notFound = ({ request }: { request: Request }) => {
      paths.push(new URL(request.url).pathname)
      return HttpResponse.json(
        {
          code: 'RESOURCE_NOT_FOUND',
          message: 'not found',
          requestId: crypto.randomUUID(),
          retryable: false
        },
        { status: 404 }
      )
    }
    mockServer.use(
      http.get(`*/api/v1/study-sessions/${missingId}/result`, notFound),
      http.get(`*/api/v1/study-sessions/${missingId}`, notFound)
    )

    await renderPage(
      `/practice/result/${missingId}`,
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
    expect(paths.toSorted()).toEqual(
      [
        `/api/v1/study-sessions/${missingId}`,
        `/api/v1/study-sessions/${missingId}/result`
      ].toSorted()
    )
  })

  it('결과 retry 후 두 요청이 모두 준비된 시점에 요약 제목을 포커스한다', async () => {
    const user = userEvent.setup()
    mockDatabase.loginAs('USER')
    const created = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionId = created.data.session.id
    const draft = (await getStudyDraftAnswers(sessionId)).data
    await submitStudySessionV2(
      sessionId,
      {
        answers: draft.answers,
        durationSec: 0,
        expectedDraftRevision: draft.revision
      },
      crypto.randomUUID()
    )
    const result = await getStudyResultV1(sessionId)
    const session = await getStudySessionV2(sessionId)
    expect(session.data.session.status).toBe('SUBMITTED')
    let resultRequestCount = 0
    let sessionRequestCount = 0
    let releaseSession = (): void => {}
    const sessionReady = new Promise<void>((resolve) => {
      releaseSession = resolve
    })
    const temporaryError = () =>
      HttpResponse.json(
        {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'temporary error',
          requestId: crypto.randomUUID(),
          retryable: true
        },
        { status: 500 }
      )

    mockServer.use(
      http.get(`*/api/v1/study-sessions/${sessionId}/result`, () => {
        resultRequestCount += 1
        return resultRequestCount === 1
          ? temporaryError()
          : HttpResponse.json(result)
      }),
      http.get(`*/api/v1/study-sessions/${sessionId}`, async ({ request }) => {
        expect(request.headers.get('X-Nihongo-Practice-Contract')).toBe('2')
        sessionRequestCount += 1
        if (sessionRequestCount === 1) return temporaryError()
        await sessionReady
        return HttpResponse.json(session.data, {
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Nihongo-Practice-Contract': '2'
          }
        })
      })
    )
    await renderPage(
      `/practice/result/${sessionId}`,
      '/practice/result/:sessionId',
      <PracticeResultPage />
    )
    expect(
      await screen.findByRole('heading', {
        name: '학습 결과를 불러오지 못했습니다'
      })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => {
      expect(resultRequestCount).toBe(2)
      expect(sessionRequestCount).toBe(2)
    })
    expect(
      screen.queryByRole('heading', { name: '학습 결과' })
    ).not.toBeInTheDocument()
    releaseSession()
    const summaryHeading = await screen.findByRole('heading', {
      name: '학습 결과'
    })
    await waitFor(() => expect(summaryHeading).toHaveFocus())
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

    await renderPage(
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

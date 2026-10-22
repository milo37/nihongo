import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { getStudySessionV2 } from '@api/study/getStudySessionV2'
import { submitStudySessionV1 } from '@api/study/submitStudySessionV1'
import { getWrongNoteV1 } from '@api/wrong-note/getWrongNoteV1'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { WrongNoteDetailPage } from '@app/wrong-note/detail/page'
import { readReviewReturnContext } from '@app/wrong-note/reviewReturnContext'
import { commitCanonicalAuth } from '@app/login/authSession'
import { authQueries } from '@app/login/queries/authQueries'
import { ToastProvider } from '@common/components/Toast'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { I18nProvider } from '@provider/I18nProvider'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { appI18n } from '@/i18n/config'
import { mockServer } from '@/test/server'

const returnTo = '/wrong-notes?view=UNREVIEWED&level=N5&subject=VOCABULARY'

const renderReadonlyDetail = async () => {
  mockDatabase.loginAs('USER')
  const created = await createStudySessionV1({
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 1
  })
  const question = toCanonicalStudySessionView(created).questions[0]
  if (!question?.sessionQuestionId)
    throw new Error('Canonical question fixture required')
  await submitStudySessionV1(
    created.session.id,
    {
      answers: [
        {
          studySessionQuestionId: question.sessionQuestionId,
          selectedOptionId: null,
          elapsedSec: 0
        }
      ],
      durationSec: 0
    },
    crypto.randomUUID()
  )
  const detail = await getWrongNoteV1(question.id)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const principal = await client.fetchQuery(authQueries.currentUser())
  await commitCanonicalAuth(client, principal)
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
          { path: 'wrong-notes/:questionId', element: <WrongNoteDetailPage /> },
          { path: 'wrong-notes', element: <h1>복습 목록 도착</h1> },
          {
            path: 'practice/session/:sessionId',
            element: <h1>단일 복습 도착</h1>
          }
        ]
      }
    ],
    {
      initialEntries: [
        `/wrong-notes/${question.id}?returnTo=${encodeURIComponent(returnTo)}`
      ]
    }
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
  await screen.findByRole('heading', {
    name: appI18n.t('wrongNote:integration.detail')
  })
  return { question, detail, router, principal }
}

describe('wrong-note approved R9 readonly workflow', () => {
  // The old editor's save/error intent is retained in useUpdateWrongNoteMemo.test.tsx.
  it('읽기 전용 문제·해설을 표시하고 목록 조건과 복귀 초점 정보를 유지한다', async () => {
    const user = userEvent.setup()
    const { question, detail, router } = await renderReadonlyDetail()
    expect(
      screen.getByRole('heading', { name: question.questionText })
    ).toBeInTheDocument()
    for (const option of question.options) {
      expect(
        screen.getByText(`${option.label}. ${option.text}`)
      ).toBeInTheDocument()
    }
    expect(screen.getByText(detail.question.explanationKo)).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: '나의 메모' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '메모 저장' })
    ).not.toBeInTheDocument()
    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(false)
    const back = screen.getByRole('link', {
      name: appI18n.t('wrongNote:integration.back')
    })
    expect(back).toHaveAttribute('href', returnTo)
    await user.click(back)
    expect(
      await screen.findByRole('heading', { name: '복습 목록 도착' })
    ).toBeInTheDocument()
    expect(router.state.location.pathname + router.state.location.search).toBe(
      returnTo
    )
    expect(router.state.location.state).toMatchObject({
      reviewFocus: question.id
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('메모 쓰기 없이 해당 문제만 복습하고 목록 복귀 문맥을 저장한다', async () => {
    const user = userEvent.setup()
    const { question, router, principal } = await renderReadonlyDetail()
    let memoWrites = 0
    mockServer.use(
      http.put(`*/api/v1/wrong-notes/${question.id}/memo`, () => {
        memoWrites += 1
        return HttpResponse.json(
          {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'temporary memo error',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 500 }
        )
      })
    )
    const retry = screen.getByRole('button', {
      name: appI18n.t('wrongNote:detail.targeted.start')
    })
    await waitFor(() => expect(retry).toBeEnabled())
    await user.click(retry)
    expect(
      await screen.findByRole('heading', { name: '단일 복습 도착' })
    ).toBeInTheDocument()
    const sessionId = router.state.location.pathname.split('/').at(-1)
    if (!sessionId) throw new Error('Targeted destination required')
    const snapshot = (await getStudySessionV2(sessionId)).data
    expect(snapshot.questions.map((item) => item.question.id)).toEqual([
      question.id
    ])
    expect(
      readReviewReturnContext(getStudyDraftPrincipalScope(principal), sessionId)
    ).toMatchObject({ questionId: question.id, returnTo })
    expect(memoWrites).toBe(0)
  })
})

import { encodeReviewEventCursor } from '@nihongo/contracts/wrong-note/list-review-events'
import { submitStudyAnswers } from '@/test/studySubmission'
import { listReviewEvents } from '@api/wrong-note/listReviewEvents'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudySessionV2 } from '@api/study/getStudySessionV2'
import { getWrongNoteV1 } from '@api/wrong-note/getWrongNoteV1'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { WrongNoteDetailPage } from '@app/wrong-note/detail/page'
import { readReviewReturnContext } from '@app/wrong-note/reviewReturnContext'
import { commitCanonicalAuth } from '@nihongo/browser/app/login/authSession'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { appI18n } from '@nihongo/browser/i18n/config'
import { mockServer } from '@/test/server'
import { analyticsClient } from '@/analytics/client'

// Japanese text keeps marks with their letters in small spans (JLP-865), so
// match the element whose whole text is the option, not one text node.
const fullText =
  (text: string) =>
  (_: string, element: Element | null): boolean =>
    element?.textContent === text &&
    ![...element.children].some((child) => child.textContent === text)

const returnTo = '/wrong-notes?state=REVIEWED&level=N5'

const renderReadonlyDetail = async (
  historyMode: 'default' | 'selected' | 'missing' | 'error' = 'default'
) => {
  mockDatabase.loginAs('USER')
  const { data: created } = await createStudySessionV2({
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count: 1
  })
  const question = toCanonicalStudySessionView(created).questions[0]
  if (!question?.sessionQuestionId)
    throw new Error('Canonical question fixture required')
  await submitStudyAnswers(
    created.session.id,
    [
      {
        studySessionQuestionId: question.sessionQuestionId,
        selectedOptionId: null,
        elapsedSec: 0
      }
    ],
    0
  )
  const detail = await getWrongNoteV1(question.id)
  const historyRequests: Array<string | null> = []
  if (historyMode !== 'default') {
    const history = await listReviewEvents(question.id, { pageSize: 20 })
    const initial = history.items[0]
    const wrongOption = detail.question.options.find(
      ({ id }) => id !== detail.question.correctOptionId
    )
    if (!initial || !wrongOption)
      throw new Error('Owned wrong-answer history required')
    const previous = { ...initial, selectedOptionId: wrongOption.id }
    const recent = {
      ...initial,
      id: crypto.randomUUID(),
      source: 'WRONG_NOTE_REVIEW' as const,
      selectedOptionId: detail.question.correctOptionId,
      isCorrect: true,
      elapsedSec: 1,
      previousStatus: initial.nextStatus,
      nextStatus: 'REVIEWING' as const,
      previousCorrectStreak: 0,
      nextCorrectStreak: 1,
      previousWrongCount: initial.wrongCountAfter,
      occurredAt: new Date(Date.parse(initial.occurredAt) + 1000).toISOString()
    }
    const cursor = encodeReviewEventCursor({
      v: 1,
      occurredAt: recent.occurredAt,
      id: recent.id
    })
    mockServer.use(
      http.get(
        `*/api/v1/wrong-notes/${question.id}/review-events`,
        ({ request }) => {
          const requestedCursor = new URL(request.url).searchParams.get(
            'cursor'
          )
          historyRequests.push(requestedCursor)
          if (historyMode === 'error')
            return HttpResponse.json(
              { message: 'history unavailable' },
              { status: 500 }
            )
          if (historyMode === 'missing')
            return HttpResponse.json({ items: [], nextCursor: null })
          return HttpResponse.json(
            requestedCursor === cursor
              ? { items: [previous], nextCursor: null }
              : { items: [recent], nextCursor: cursor }
          )
        }
      )
    )
  }
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
  await screen.findByRole('heading', { level: 1 })
  return { question, detail, router, principal, historyRequests }
}

describe('wrong-note approved R9 readonly workflow', () => {
  it('읽기 전용 문제·해설을 표시하고 목록 조건과 복귀 초점 정보를 유지한다', async () => {
    const user = userEvent.setup()
    const { question, detail, router } = await renderReadonlyDetail()
    expect(
      screen.getByRole('heading', { name: question.questionText })
    ).toBeInTheDocument()
    for (const option of question.options) {
      expect(
        screen.getByText(fullText(`${option.label}. ${option.text}`))
      ).toBeInTheDocument()
    }
    expect(screen.getByText(detail.question.explanationKo)).toBeInTheDocument()
    expect(
      await screen.findByText(appI18n.t('wrongNote:detail.noAnswer'))
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '메모 쓰기' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('새 오답')).not.toBeInTheDocument()
    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(false)
    const back = screen.getByRole('link', {
      name: appI18n.t('wrongNote:detail.back')
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

  it('follows only the needed history cursor and labels the previous answer as readonly text', async () => {
    const { detail, historyRequests } = await renderReadonlyDetail('selected')
    const marker = await screen.findByText(
      appI18n.t('wrongNote:detail.myAnswer')
    )
    const row = marker.closest('li')
    const wrongOption = detail.question.options.find(
      ({ id }) => id !== detail.question.correctOptionId
    )
    if (!row || !wrongOption)
      throw new Error('Historical wrong option row required')
    expect(
      within(row).getByText(
        fullText(`${wrongOption.label}. ${wrongOption.text}`)
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(appI18n.t('wrongNote:detail.correctAnswer'))
    ).toBeInTheDocument()
    expect(row).not.toHaveAttribute('aria-selected')
    expect(row).not.toHaveAttribute('aria-pressed')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(historyRequests).toHaveLength(2)
    expect(historyRequests[0]).toBeNull()
    expect(historyRequests[1]).not.toBeNull()
    expect(
      screen.queryByText(appI18n.t('wrongNote:detail.noAnswer'))
    ).not.toBeInTheDocument()
  })

  it('keeps missing history distinct from an unanswered attempt', async () => {
    await renderReadonlyDetail('missing')
    expect(
      await screen.findByText('내가 고른 답을 불러올 수 없어요')
    ).toBeInTheDocument()
    expect(
      screen.queryByText(appI18n.t('wrongNote:detail.noAnswer'))
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '이 문제 다시 풀기' })
    ).toBeInTheDocument()
  })

  it('reports a history read error while preserving the question and explanation', async () => {
    const { question, detail } = await renderReadonlyDetail('error')
    expect(
      await screen.findByText('내가 고른 답을 불러오지 못했어요.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: question.questionText })
    ).toBeInTheDocument()
    expect(screen.getByText(detail.question.explanationKo)).toBeInTheDocument()
    expect(
      screen.queryByText(appI18n.t('wrongNote:detail.noAnswer'))
    ).not.toBeInTheDocument()
  })
})

describe('wrong-note restricted account', () => {
  const restrictedMessage =
    '지금은 이용이 잠시 제한된 계정이에요. 제한이 풀리면 다시 학습하고 신고할 수 있어요.'

  it('제한된 계정이 단일 복습을 시작하면 제한 안내를 보여 주고 머문다', async () => {
    const user = userEvent.setup()
    const { router, principal } = await renderReadonlyDetail()
    if (!principal) throw new Error('Signed-in principal required')
    mockDatabase.setAccountRestricted(principal.id, true)
    const start = screen.getByRole('button', {
      name: appI18n.t('wrongNote:detail.targeted.start')
    })
    await waitFor(() => expect(start).toBeEnabled())
    await user.click(start)
    const notice = await screen.findByText(restrictedMessage)
    expect(notice).toHaveAttribute('role', 'alert')
    await waitFor(() => expect(notice).toHaveFocus())
    expect(
      screen.queryByText(appI18n.t('wrongNote:detail.targeted.error'))
    ).toBeNull()
    expect(router.state.location.pathname).toMatch(/^\/wrong-notes\//u)
  })

  it('제한된 계정이 문제를 신고하면 제한 안내를 보여 준다', async () => {
    const user = userEvent.setup()
    const { principal } = await renderReadonlyDetail()
    if (!principal) throw new Error('Signed-in principal required')
    mockDatabase.setAccountRestricted(principal.id, true)
    await user.click(screen.getByRole('button', { name: '문제가 이상해요' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(
      within(dialog).getByRole('textbox', { name: /어디가 이상한가요/u }),
      '보기 문구를 확인해 주세요.'
    )
    await user.click(within(dialog).getByRole('button', { name: '보내기' }))
    const notice = await within(dialog).findByText(restrictedMessage)
    expect(notice).toBeVisible()
    expect(notice).toHaveClass('bg-amber-50')
    expect(notice).not.toHaveClass('text-red-700')
    expect(
      within(dialog).queryByText('보내지 못했어요. 다시 시도해 주세요.')
    ).toBeNull()
    expect(
      within(dialog).getByRole('textbox', { name: /어디가 이상한가요/u })
    ).toHaveValue('보기 문구를 확인해 주세요.')
  })
})

describe('wrong-note question report', () => {
  it('사유 없이 설명만 받아 화면 키와 문항 번호로 제보를 접수한다', async () => {
    const user = userEvent.setup()
    const track = vi.spyOn(analyticsClient, 'track')
    const { question, detail } = await renderReadonlyDetail()
    await user.click(screen.getByRole('button', { name: '문제가 이상해요' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('combobox')).toBeNull()
    await user.type(
      within(dialog).getByRole('textbox', { name: /어디가 이상한가요/u }),
      '정답 표시가 이상합니다.'
    )
    await user.click(within(dialog).getByRole('button', { name: '보내기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      await screen.findByText('신고를 보냈어요. 고마워요!')
    ).toBeInTheDocument()
    expect(mockDatabase.peekUserReports()).toEqual([
      expect.objectContaining({
        kind: 'QUESTION',
        location: 'wrongNoteDetail#1',
        questionVersionId: detail.question.questionVersionId,
        description: '정답 표시가 이상합니다.'
      })
    ])
    expect(question.id).toBe(detail.question.id)
    expect(track).toHaveBeenCalledWith({
      event: 'report_submitted',
      payload: { kind: 'QUESTION' }
    })
    track.mockRestore()
  })
})

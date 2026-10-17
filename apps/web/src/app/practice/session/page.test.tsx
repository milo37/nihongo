import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudyDraftAnswers } from '@api/study/getStudyDraftAnswers'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { applyStudyDraftDiff } from '@app/practice/draft/studyDraftMerge'
import { PracticeSessionPage } from '@app/practice/session/page'
import { ToastProvider } from '@common/components/Toast'
import { queryClient } from '@libs/queryClient'
import { I18nProvider } from '@provider/I18nProvider'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'

const renderSession = (sessionId: string) => {
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
      { path: '/practice/result/:sessionId', element: <p>제출 결과 도착</p> }
    ],
    { initialEntries: [`/practice/session/${sessionId}`] }
  )
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
  return router
}

const readDraftSelection = (sessionQuestionId: string): string | null => {
  const workingCopy = useAppStore.getState().draftWorkingCopy
  if (!workingCopy) return null
  return (
    applyStudyDraftDiff(
      workingCopy.confirmedBase,
      workingCopy.localDiff
    ).answers.find(
      (answer) => answer.studySessionQuestionId === sessionQuestionId
    )?.selectedOptionId ?? null
  )
}

describe('PracticeSessionPage', () => {
  it('숫자 키와 클릭 선택이 같은 답안 상태와 radio 상태를 갱신한다', async () => {
    const user = userEvent.setup()
    const response = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 5
    })
    const sessionPayload = toCanonicalStudySessionView(response.data)
    const firstQuestion = sessionPayload.questions[0]
    if (!firstQuestion?.sessionQuestionId)
      throw new Error('Canonical session question required')
    const [first, second] = firstQuestion.options
    if (!first || !second) throw new Error('Two public options required')
    useAppStore
      .getState()
      .beginPractice(
        sessionPayload.session.id,
        sessionPayload.session.startedAt
      )
    renderSession(sessionPayload.session.id)
    const firstOption = await screen.findByRole('radio', {
      name: `1. ${first.text}`
    })
    const secondOption = screen.getByRole('radio', {
      name: `2. ${second.text}`
    })
    await waitFor(() => expect(firstOption).toBeEnabled())
    fireEvent.keyDown(window, { key: '2' })
    expect(secondOption).toBeChecked()
    expect(readDraftSelection(firstQuestion.sessionQuestionId)).toBe(second.id)
    await user.click(firstOption)
    expect(firstOption).toBeChecked()
    expect(secondOption).not.toBeChecked()
    expect(readDraftSelection(firstQuestion.sessionQuestionId)).toBe(first.id)
    fireEvent.keyDown(firstOption, { key: '2' })
    expect(secondOption).toBeChecked()
    expect(readDraftSelection(firstQuestion.sessionQuestionId)).toBe(second.id)
  })

  it('제출 Dialog가 열리면 배경 문제의 숫자 단축키를 비활성화한다', async () => {
    const user = userEvent.setup()
    const response = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionPayload = toCanonicalStudySessionView(response.data)
    const question = sessionPayload.questions[0]
    if (!question?.sessionQuestionId)
      throw new Error('Canonical session question required')
    const [first, second] = question.options
    if (!first || !second) throw new Error('Two public options required')
    useAppStore
      .getState()
      .beginPractice(
        sessionPayload.session.id,
        sessionPayload.session.startedAt
      )
    renderSession(sessionPayload.session.id)
    const firstOption = await screen.findByRole('radio', {
      name: `1. ${first.text}`
    })
    const secondOption = screen.getByRole('radio', {
      name: `2. ${second.text}`
    })
    await user.click(firstOption)
    const submit = screen.getByRole('button', { name: '답안 제출' })
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)
    expect(
      await screen.findByRole('heading', { name: '답안을 제출하시겠습니까?' })
    ).toBeInTheDocument()
    const selectionBefore = readDraftSelection(question.sessionQuestionId)
    fireEvent.keyDown(window, { key: '2' })
    expect(firstOption).toBeChecked()
    expect(secondOption).not.toBeChecked()
    expect(readDraftSelection(question.sessionQuestionId)).toBe(selectionBefore)
  })

  it('이미 제출한 세션으로 돌아오면 결과 경로로 이동한다', async () => {
    const { data: sessionPayload } = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const draft = (await getStudyDraftAnswers(sessionPayload.session.id)).data
    await submitStudySessionV2(
      sessionPayload.session.id,
      {
        answers: draft.answers,
        durationSec: 0,
        expectedDraftRevision: draft.revision
      },
      crypto.randomUUID()
    )
    const router = renderSession(sessionPayload.session.id)
    expect(await screen.findByText('제출 결과 도착')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(
      `/practice/result/${sessionPayload.session.id}`
    )
  })
})

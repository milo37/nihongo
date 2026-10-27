import { http, HttpResponse } from 'msw'
import { mockServer } from '@/test/server'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudyDraftAnswers } from '@api/study/getStudyDraftAnswers'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import { toCanonicalStudySessionView } from '@app/practice/adapters/studySessionView'
import { applyStudyDraftDiff } from '@nihongo/browser/app/practice/draft/studyDraftMerge'
import { PracticeSessionPage } from '@app/practice/session/page'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { useAppStore } from '@nihongo/browser/store/index'

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
    const back = screen.getByRole('link', { name: '학습으로 돌아가기' })
    expect(back).toHaveAttribute('href', '/practice')
    expect(back).toHaveTextContent('')
    expect(back.querySelectorAll('svg')).toHaveLength(1)
    expect(back).toHaveClass('size-11')
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

  it('저장 중과 실패·재시도를 분리하며 답안과 서버 저장 완료 의미를 유지한다', async () => {
    const user = userEvent.setup()
    const response = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const payload = toCanonicalStudySessionView(response.data)
    const option = payload.questions[0]?.options[0]
    if (!option) throw new Error('Public option required')
    useAppStore
      .getState()
      .beginPractice(payload.session.id, payload.session.startedAt)
    let finish: (() => void) | undefined
    const responseGate = new Promise<void>((resolve) => {
      finish = resolve
    })
    mockServer.use(
      http.put(
        '*/api/v1/study-sessions/:sessionId/draft-answers',
        async () => {
          await responseGate
          return HttpResponse.json(
            { code: 'SERVER_ERROR', message: 'synthetic draft failure' },
            { status: 500 }
          )
        },
        { once: true }
      )
    )
    renderSession(payload.session.id)
    const radio = await screen.findByRole('radio', {
      name: `1. ${option.text}`
    })
    await waitFor(() => expect(radio).toBeEnabled())
    await user.click(radio)
    try {
      await waitFor(
        () => expect(useAppStore.getState().draftSaveState).toBe('saving'),
        { timeout: 4000 }
      )
      expect(
        screen.getByText('학습 기록을 저장하고 있어요…')
      ).toBeInTheDocument()
      expect(
        screen.queryByText('학습 기록이 자동으로 저장됐어요')
      ).not.toBeInTheDocument()
      expect(document.querySelector('.study-save-toast')).toBeNull()
      expect(
        document.querySelector('[role="status"][data-save-state]')
      ).toBeNull()
    } finally {
      finish?.()
    }
    await screen.findByText(
      '학습 기록을 저장하지 못했어요',
      {},
      { timeout: 4000 }
    )
    const retry = screen.getByRole('button', { name: '작업본 저장 다시 시도' })
    expect(retry).toHaveTextContent('다시 시도')
    expect(retry.closest('[role="status"]')).toHaveAttribute(
      'data-tone',
      'danger'
    )
    expect(screen.queryByText('답안이 저장되었습니다.')).not.toBeInTheDocument()
    expect(radio).toBeChecked()
    await user.click(retry)
    const saved = await screen.findByText(
      '학습 기록이 자동으로 저장됐어요',
      {},
      { timeout: 6000 }
    )
    expect(saved.closest('.study-inline-save-current')).toHaveAttribute(
      'aria-live',
      'off'
    )
    expect(document.querySelector('.study-save-toast')).toBeNull()
    expect(
      screen.queryByText(/^서버에 저장했습니다. 마지막 저장/)
    ).not.toBeInTheDocument()
    expect(
      document.querySelector('[role="status"][data-save-state]')
    ).toBeNull()
    expect(radio).toBeChecked()
    expect(
      (await getStudyDraftAnswers(payload.session.id)).data.answers[0]
        ?.selectedOptionId
    ).toBe(option.id)
  }, 10_000)

  it.each(['ko', 'ja'] as const)(
    '보기 뒤 인라인 상태가 실제 저장과 오프라인·충돌을 반영하고 답안 초점을 유지한다 (%s)',
    async (locale) => {
      writeUiLocalePreference(locale)
      const savedLabel =
        locale === 'ko'
          ? '학습 기록이 자동으로 저장됐어요'
          : '学習記録を自動保存しました'
      const user = userEvent.setup()
      const response = await createStudySessionV2({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      })
      const payload = toCanonicalStudySessionView(response.data)
      const [first, second] = payload.questions[0]?.options ?? []
      if (!first || !second) throw new Error('Two public options required')
      useAppStore
        .getState()
        .beginPractice(payload.session.id, payload.session.startedAt)
      renderSession(payload.session.id)
      const firstRadio = await screen.findByRole('radio', {
        name: `1. ${first.text}`
      })
      const secondRadio = screen.getByRole('radio', {
        name: `2. ${second.text}`
      })
      await waitFor(() => expect(firstRadio).toBeEnabled())
      expect(document.querySelector('.study-save-toast')).toBeNull()
      const back = screen.getByRole('link', {
        name: locale === 'ko' ? '학습으로 돌아가기' : '学習に戻る'
      })
      expect(back).toHaveAttribute('href', '/practice')
      expect(back).toHaveTextContent(/^$/)
      expect(back.querySelectorAll('svg')).toHaveLength(1)
      const statusRow = document.querySelector('.study-inline-save')
      expect(statusRow).not.toBeNull()
      expect(
        statusRow?.previousElementSibling?.querySelector('fieldset')
      ).toContainElement(firstRadio)
      expect(statusRow?.nextElementSibling).toHaveClass('study-keyboard-help')
      expect(
        screen.getByText(savedLabel).closest('[aria-live]')
      ).toHaveAttribute('aria-live', 'off')
      await user.click(firstRadio)
      await screen.findByText(savedLabel, {}, { timeout: 4000 })
      expect(document.querySelector('.study-save-toast')).toBeNull()
      expect(firstRadio).toHaveFocus()
      expect(
        within(statusRow as HTMLElement).queryByRole('button')
      ).not.toBeInTheDocument()
      const revision =
        useAppStore.getState().draftWorkingCopy?.confirmedBase.revision ?? -1
      await user.click(secondRadio)
      await waitFor(
        () => {
          expect(useAppStore.getState().draftSaveState).toBe('saved')
          expect(
            useAppStore.getState().draftWorkingCopy?.confirmedBase.revision
          ).toBeGreaterThan(revision)
        },
        { timeout: 6000 }
      )
      expect(document.querySelectorAll('.study-inline-save')).toHaveLength(1)
      expect(document.querySelector('.study-inline-save')).toBe(statusRow)
      expect(document.querySelector('.study-save-toast')).toBeNull()
      expect(secondRadio).toHaveFocus()
      expect(
        (await getStudyDraftAnswers(payload.session.id)).data.answers[0]
          ?.selectedOptionId
      ).toBe(second.id)
      act(() => useAppStore.getState().setDraftSaveState('offline'))
      expect(screen.queryByText(savedLabel)).not.toBeInTheDocument()
      expect(
        screen.getByText(
          locale === 'ko'
            ? '오프라인 · 이 기기에 임시 보관 중'
            : 'オフライン・この端末に一時保存中'
        )
      ).toBeInTheDocument()
      expect(
        document.querySelector('[role="status"][data-save-state]')
      ).toBeNull()
      expect(
        within(statusRow as HTMLElement).getByRole('button')
      ).toHaveTextContent(locale === 'ko' ? '다시 시도' : '再試行')
      expect(secondRadio).toHaveFocus()
      act(() => useAppStore.setState({ isDraftConflictPending: true }))
      expect(
        document.querySelector('[role="status"][data-save-state]')
      ).toHaveAttribute('data-save-state', 'offline')
      expect(
        document.querySelector('[role="status"][data-save-state]')
      ).toHaveTextContent(
        locale === 'ko'
          ? '로컬 작업을 보존한 채 충돌을 확인합니다.'
          : 'ローカル作業を保持したまま競合を確認します。'
      )
      expect(
        within(statusRow as HTMLElement).queryByRole('button')
      ).not.toBeInTheDocument()
      expect(screen.queryByText(savedLabel)).not.toBeInTheDocument()
      expect(secondRadio).toBeDisabled()
    },
    10_000
  )
})

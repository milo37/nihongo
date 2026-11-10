import { http, HttpResponse } from 'msw'
import { mockServer } from '@/test/server'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
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
import {
  clearSubmissionAttemptMemoryCache,
  readStoredSubmissionAttempt,
  writeStoredSubmissionAttempt
} from '@nihongo/browser/app/practice/submissionAttemptStorage'
import { createStudyDraftWorkingCopy } from '@nihongo/browser/app/practice/draft/studyDraftWorkingCopy'
import {
  clearStudyDraftWorkingCopyMemoryCache,
  readStudyDraftWorkingCopy,
  writeStudyDraftWorkingCopy
} from '@nihongo/browser/app/practice/draft/studyDraftWorkingCopyStorage'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { commitCanonicalAuth } from '@nihongo/browser/app/login/authSession'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'

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
      { path: '/practice/result/:sessionId', element: <p>제출 결과 도착</p> },
      { path: '/practice', element: <p>학습 설정 도착</p> },
      { path: '/login', element: <p>로그인 화면 도착</p> }
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
  it.each(['GUEST', 'USER'] as const)(
    'preserves attempts and other local work for an unknown 404 owner (%s)',
    async (role) => {
      if (role === 'USER') {
        mockDatabase.loginAs('USER')
        const principal = await queryClient.fetchQuery(
          authQueries.currentUser()
        )
        await commitCanonicalAuth(queryClient, principal)
      }
      const created = await createStudySessionV2({
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      })
      const sessionId = created.data.session.id
      const snapshot = (await getStudyDraftAnswers(sessionId)).data
      const otherSessionId = crypto.randomUUID()
      const copies = [
        createStudyDraftWorkingCopy({
          confirmedBase: snapshot,
          principalScope: 'GUEST',
          sessionId
        }),
        createStudyDraftWorkingCopy({
          confirmedBase: snapshot,
          principalScope: 'USER:another-account',
          sessionId
        }),
        createStudyDraftWorkingCopy({
          confirmedBase: { ...snapshot, studySessionId: otherSessionId },
          principalScope: 'GUEST',
          sessionId: otherSessionId
        })
      ].map(writeStudyDraftWorkingCopy)
      const oldAttempt = {
        logicalRequest: { answers: [], durationSec: 1 },
        idempotencyKey: crypto.randomUUID()
      }
      writeStoredSubmissionAttempt(sessionId, oldAttempt)
      mockServer.use(
        http.get(`*/api/v1/study-sessions/${sessionId}`, () =>
          HttpResponse.json(
            { code: 'RESOURCE_NOT_FOUND', message: 'synthetic' },
            { status: 404 }
          )
        )
      )
      const router = renderSession(sessionId)
      expect(
        await screen.findByRole('heading', {
          name: '이 학습을 찾을 수 없어요'
        })
      ).toBeVisible()
      expect(readStoredSubmissionAttempt(sessionId)).toEqual(oldAttempt)
      copies.forEach((copy) =>
        expect(
          readStudyDraftWorkingCopy(copy.principalScope, copy.sessionId)
        ).toEqual(copy)
      )
      await userEvent.click(screen.getByRole('link', { name: '새로 시작하기' }))
      expect(router.state.location.pathname).toBe('/practice')
      clearSubmissionAttemptMemoryCache()
      clearStudyDraftWorkingCopyMemoryCache()
      expect(readStoredSubmissionAttempt(sessionId)).toEqual(oldAttempt)
      // After a reload only members' copies remain; a guest's lived in memory.
      copies.forEach((copy) =>
        expect(
          readStudyDraftWorkingCopy(copy.principalScope, copy.sessionId)
        ).toEqual(copy.principalScope === 'GUEST' ? null : copy)
      )
    }
  )
  it('clears a stored attempt after an owned V2 terminal response', async () => {
    const created = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionId = created.data.session.id
    writeStoredSubmissionAttempt(sessionId, {
      logicalRequest: { answers: [], durationSec: 1 },
      idempotencyKey: crypto.randomUUID()
    })
    mockServer.use(
      http.get(`*/api/v1/study-sessions/${sessionId}`, () =>
        HttpResponse.json(
          {
            ...created.data,
            session: { ...created.data.session, status: 'EXPIRED' }
          },
          {
            headers: {
              'Cache-Control': 'private, no-store',
              'X-Nihongo-Practice-Contract': '2'
            }
          }
        )
      )
    )
    renderSession(sessionId)
    await waitFor(() =>
      expect(readStoredSubmissionAttempt(sessionId)).toBeNull()
    )
  })
  it.each([
    [404, 'RESOURCE_NOT_FOUND'],
    [500, 'INTERNAL_SERVER_ERROR']
  ] as const)(
    'keeps %s errors distinct from a retired-session notice',
    async (status, code) => {
      const sessionId = crypto.randomUUID()
      let requestCount = 0
      mockServer.use(
        http.get(`*/api/v1/study-sessions/${sessionId}`, () => {
          requestCount += 1
          return HttpResponse.json({ code, message: 'synthetic' }, { status })
        })
      )
      const router = renderSession(sessionId)
      await waitFor(() =>
        expect(
          screen.getByRole('heading', {
            name:
              status === 404
                ? '이 학습을 찾을 수 없어요'
                : '문제를 불러오지 못했어요'
          })
        ).toBeVisible()
      )
      if (status === 404) {
        const link = await screen.findByRole('link', {
          name: '새로 시작하기'
        })
        expect(link).toHaveAttribute('href', '/practice')
        await userEvent.click(link)
        expect(router.state.location.pathname).toBe('/practice')
        expect(requestCount).toBeLessThanOrEqual(2)
      }
      expect(
        screen.queryByRole('heading', {
          name: '이 학습은 끝났어요'
        })
      ).not.toBeInTheDocument()
    }
  )
  it.each(['ko', 'ja'] as const)(
    'shows an ended-session notice for an older owned session and keeps its stored attempt (%s)',
    async (locale) => {
      writeUiLocalePreference(locale)
      const sessionId = crypto.randomUUID()
      const oldAttempt = {
        logicalRequest: { answers: [], durationSec: 1 },
        idempotencyKey: crypto.randomUUID()
      }
      writeStoredSubmissionAttempt(sessionId, oldAttempt)
      let submissions = 0
      mockServer.use(
        http.get(`*/api/v1/study-sessions/${sessionId}`, () =>
          HttpResponse.json(
            {
              code: 'PRACTICE_CONTRACT_VERSION_MISMATCH',
              message: 'old session'
            },
            { status: 409 }
          )
        ),
        http.post(`*/api/v1/study-sessions/${sessionId}/submit`, () => {
          submissions += 1
          return HttpResponse.json({}, { status: 500 })
        })
      )
      const router = renderSession(sessionId)
      const title =
        locale === 'ko' ? '이 학습은 끝났어요' : 'この学習は終わりました'
      expect(await screen.findByRole('heading', { name: title })).toBeVisible()
      expect(
        screen.getByRole('link', {
          name: locale === 'ko' ? '새로 시작하기' : '新しく始める'
        })
      ).toHaveAttribute('href', '/practice')
      expect(
        screen.queryByRole('button', {
          name: locale === 'ko' ? '제출하기' : '提出する'
        })
      ).not.toBeInTheDocument()
      expect(readStoredSubmissionAttempt(sessionId)).toEqual(oldAttempt)
      expect(submissions).toBe(0)
      await userEvent.click(
        screen.getByRole('link', {
          name: locale === 'ko' ? '새로 시작하기' : '新しく始める'
        })
      )
      expect(router.state.location.pathname).toBe('/practice')
      expect(readStoredSubmissionAttempt(sessionId)).toEqual(oldAttempt)
    }
  )
  it('preserves an old stored attempt if a legacy expired payload is unexpectedly returned', async () => {
    const created = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const sessionId = created.data.session.id
    const oldAttempt = {
      logicalRequest: { answers: [], durationSec: 1 },
      idempotencyKey: crypto.randomUUID()
    }
    writeStoredSubmissionAttempt(sessionId, oldAttempt)
    mockServer.use(
      http.get(`*/api/v1/study-sessions/${sessionId}`, () =>
        HttpResponse.json(
          {
            ...created.data,
            session: {
              ...created.data.session,
              practiceContractVersion: 1,
              status: 'EXPIRED'
            }
          },
          {
            headers: {
              'Cache-Control': 'private, no-store',
              'X-Nihongo-Practice-Contract': '1'
            }
          }
        )
      )
    )
    renderSession(sessionId)
    expect(
      await screen.findByRole('heading', {
        name: '이 학습은 끝났어요'
      })
    ).toBeVisible()
    expect(readStoredSubmissionAttempt(sessionId)).toEqual(oldAttempt)
  })
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
    const back = screen.getByRole('link', { name: '학습 화면으로' })
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

  it('풀이 중에는 정답을 드러낼 수 있는 태그를 보여 주지 않는다', async () => {
    const response = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 5
    })
    const sessionPayload = toCanonicalStudySessionView(response.data)
    const tags = sessionPayload.questions.flatMap((question) => question.tags)
    expect(tags.length).toBeGreaterThan(0)
    useAppStore
      .getState()
      .beginPractice(
        sessionPayload.session.id,
        sessionPayload.session.startedAt
      )
    renderSession(sessionPayload.session.id)
    const heading = await screen.findByRole('heading', { level: 1 })
    const card = heading.closest('article')
    if (!card) throw new Error('Question card required')
    for (const tag of new Set(tags)) {
      expect(within(card).queryByText(tag, { exact: true })).toBeNull()
    }
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
    // Unanswered, so submitting asks first (subtract #9).
    const submit = screen.getByRole('button', { name: '제출하기' })
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)
    expect(
      await screen.findByRole('heading', { name: '제출할까요?' })
    ).toBeInTheDocument()
    const selectionBefore = readDraftSelection(question.sessionQuestionId)
    fireEvent.keyDown(window, { key: '2' })
    expect(firstOption).not.toBeChecked()
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

  it.each([
    ['ko', '다른 곳에서 푼 답을 불러왔어요. 답을 확인해 주세요.'],
    ['ja', '別の場所で解いた答えを読み込みました。答えを確認してください。']
  ] as const)(
    'announces the applied server record after a 409 and clears it on the next answer (%s)',
    async (locale, message) => {
      // Server drafts are members only (guests keep answers locally).
      await loginAsUser()
      writeUiLocalePreference(locale)
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
      const initial = (await getStudyDraftAnswers(payload.session.id)).data
      const remote = {
        ...initial,
        revision: initial.revision + 1,
        savedAt: new Date().toISOString()
      }
      useAppStore
        .getState()
        .beginPractice(payload.session.id, payload.session.startedAt)
      renderSession(payload.session.id)
      const radio = await screen.findByRole('radio', {
        name: `1. ${option.text}`
      })
      await waitFor(() => expect(radio).toBeEnabled())
      let puts = 0
      mockServer.use(
        http.put('*/api/v1/study-sessions/:sessionId/draft-answers', () => {
          puts += 1
          return HttpResponse.json(
            { code: 'DRAFT_VERSION_CONFLICT', message: 'synthetic conflict' },
            { status: 409 }
          )
        }),
        http.get('*/api/v1/study-sessions/:sessionId/draft-answers', () =>
          HttpResponse.json(remote, {
            headers: {
              'Cache-Control': 'private, no-store',
              'X-Nihongo-Practice-Contract': '2'
            }
          })
        )
      )
      await user.click(radio)
      const notice = await screen.findByText(message, {}, { timeout: 6000 })
      expect(notice.closest('[role=status]')).toHaveAttribute(
        'aria-live',
        'polite'
      )
      expect(puts).toBe(1)
      expect(radio).not.toBeChecked()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await user.click(radio)
      expect(screen.queryByText(message)).not.toBeInTheDocument()
    },
    10_000
  )

  it('저장 중과 실패·재시도를 분리하며 답안과 서버 저장 완료 의미를 유지한다', async () => {
    // Server drafts are members only (guests keep answers locally).
    await loginAsUser()
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
      // Saving is quiet (direction §6-4).
      expect(
        document.querySelector('[data-save-state="saving"]')
      ).not.toBeVisible()
      expect(screen.queryByText('저장하는 중…')).not.toBeInTheDocument()
      expect(screen.queryByText('자동 저장됨')).not.toBeInTheDocument()
      expect(document.querySelector('.study-save-toast')).toBeNull()
      expect(
        document.querySelector('[role="status"][data-save-state]')
      ).toBeNull()
    } finally {
      finish?.()
    }
    await screen.findByText('저장하지 못했어요', {}, { timeout: 4000 })
    const retry = screen.getByRole('button', { name: '다시 저장' })
    expect(retry).toHaveTextContent('다시 시도')
    expect(retry.closest('[role="status"]')).toHaveAttribute(
      'data-tone',
      'danger'
    )
    expect(screen.queryByText('답안이 저장되었습니다.')).not.toBeInTheDocument()
    expect(radio).toBeChecked()
    await user.click(retry)
    await waitFor(
      () =>
        expect(screen.queryByText('저장하지 못했어요')).not.toBeInTheDocument(),
      { timeout: 6000 }
    )
    expect(screen.queryByText('자동 저장됨')).not.toBeInTheDocument()
    expect(document.querySelector('.study-save-toast')).toBeNull()
    expect(
      screen.queryByText(/^서버에 저장했어요. 마지막 저장/)
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
      // Server drafts are members only (guests keep answers locally).
      await loginAsUser()
      writeUiLocalePreference(locale)
      const savedLabel = locale === 'ko' ? '자동 저장됨' : '自動保存しました'
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
        name: locale === 'ko' ? '학습 화면으로' : '学習画面へ'
      })
      expect(back).toHaveAttribute('href', '/practice')
      expect(back).toHaveTextContent(/^$/)
      expect(back.querySelectorAll('svg')).toHaveLength(1)
      // Routine saving is quiet; only a failure shows a line (direction §6-4).
      expect(document.querySelector('.study-inline-save')).toBeNull()
      expect(screen.queryByText(savedLabel)).not.toBeInTheDocument()
      await user.click(firstRadio)
      await waitFor(
        () => expect(useAppStore.getState().draftSaveState).toBe('saved'),
        { timeout: 4000 }
      )
      expect(screen.queryByText(savedLabel)).not.toBeInTheDocument()
      expect(document.querySelector('.study-save-toast')).toBeNull()
      expect(firstRadio).toHaveFocus()
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
      expect(secondRadio).toHaveFocus()
      expect(
        (await getStudyDraftAnswers(payload.session.id)).data.answers[0]
          ?.selectedOptionId
      ).toBe(second.id)
      act(() => useAppStore.getState().setDraftSaveState('offline'))
      const statusRow = document.querySelector('.study-inline-save')
      expect(statusRow).not.toBeNull()
      expect(
        statusRow?.previousElementSibling?.querySelector('fieldset')
      ).toContainElement(firstRadio)
      expect(
        screen.getByText(
          locale === 'ko'
            ? '연결 끊김 · 이 기기에만 저장 중'
            : '接続なし · この端末にだけ保存中'
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
      const detailedStatus = document.querySelector(
        '[role="status"][data-save-state]'
      )
      expect(detailedStatus).toHaveTextContent(
        locale === 'ko'
          ? '인터넷 연결이 끊겼어요. 답은 이 기기에 보관했다가 연결되면 저장할게요.'
          : 'インターネット接続が切れました。答えはこの端末に残しておき、つながったら保存します。'
      )
      expect(
        within(detailedStatus as HTMLElement).getByRole('button')
      ).toHaveTextContent(locale === 'ko' ? '다시 저장' : 'もう一度保存')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(document.querySelector('.study-inline-save')).toBeNull()
      expect(screen.queryByText(savedLabel)).not.toBeInTheDocument()
      expect(secondRadio).toBeDisabled()
    },
    10_000
  )

  const startSession = async (count: number) => {
    const response = await createStudySessionV2({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count
    })
    const payload = toCanonicalStudySessionView(response.data)
    useAppStore
      .getState()
      .beginPractice(payload.session.id, payload.session.startedAt)
    return payload
  }

  const loginAsUser = async (): Promise<void> => {
    mockDatabase.loginAs('USER')
    const principal = await queryClient.fetchQuery(authQueries.currentUser())
    await commitCanonicalAuth(queryClient, principal)
  }

  it('게스트 책갈피는 로그인 토스트로 안내하고 [로그인]을 눌러야 이동한다', async () => {
    const user = userEvent.setup()
    const payload = await startSession(1)
    const option = payload.questions[0]?.options[0]
    if (!option) throw new Error('Public option required')
    renderSession(payload.session.id)
    const radio = await screen.findByRole('radio', {
      name: `1. ${option.text}`
    })
    await waitFor(() => expect(radio).toBeEnabled())
    const bookmark = screen.getByRole('button', {
      name: '1번 문제를 책갈피에 담기'
    })
    expect(bookmark).toHaveAttribute('aria-pressed', 'false')
    await user.click(bookmark)
    // A toast with [로그인]; nothing moves and the button stays unpressed (L7).
    const toasts = await screen.findByRole('region', { name: '알림' })
    expect(
      within(toasts).getByText('책갈피는 로그인하면 쓸 수 있어요.')
    ).toBeVisible()
    expect(
      within(toasts).getByText('지금 풀던 문제는 로그인 뒤에 이어지지 않아요.')
    ).toBeVisible()
    expect(bookmark).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('link', { name: '로그인 선택' })).toBeNull()
    await user.click(within(toasts).getByRole('button', { name: '로그인' }))
    // Leaving the session still asks first.
    await user.click(
      within(
        await screen.findByRole('dialog', { name: '그만 풀까요?' })
      ).getByRole('button', { name: '나가기' })
    )
    expect(await screen.findByText('로그인 화면 도착')).toBeInTheDocument()
  })

  it('USER 책갈피 추가·해제가 버튼 상태와 안내를 갱신한다', async () => {
    const user = userEvent.setup()
    await loginAsUser()
    const payload = await startSession(1)
    const option = payload.questions[0]?.options[0]
    if (!option) throw new Error('Public option required')
    renderSession(payload.session.id)
    const radio = await screen.findByRole('radio', {
      name: `1. ${option.text}`
    })
    await waitFor(() => expect(radio).toBeEnabled())
    const add = screen.getByRole('button', { name: '1번 문제를 책갈피에 담기' })
    await waitFor(() => expect(add).toBeEnabled())
    await user.click(add)
    // Success is a toast, not text under the button.
    const toasts = await screen.findByRole('region', { name: '알림' })
    expect(await within(toasts).findByText('책갈피에 담았어요.')).toBeVisible()
    const remove = screen.getByRole('button', {
      name: '1번 문제를 책갈피에서 빼기'
    })
    expect(remove).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(remove).toBeEnabled())
    await user.click(remove)
    expect(await within(toasts).findByText('책갈피에서 뺐어요.')).toBeVisible()
    // One bookmark toast at a time: the second replaced the first.
    expect(within(toasts).getAllByRole('article')).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: '1번 문제를 책갈피에 담기' })
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('이전·다음·바로가기 이동이 문제 번호, 진행 표시, 버튼 상태를 맞춘다', async () => {
    const user = userEvent.setup()
    const payload = await startSession(3)
    const [first] = payload.questions
    if (!first) throw new Error('Question required')
    renderSession(payload.session.id)
    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('1번 문제.')
    const firstRadio = screen.getByRole('radio', {
      name: `1. ${first.options[0]?.text ?? ''}`
    })
    await waitFor(() => expect(firstRadio).toBeEnabled())
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled()
    // The number sheet opens from the top bar's "1 / 3" (direction §6-4).
    const openSheet = async (position: string): Promise<HTMLElement> => {
      await user.click(
        screen.getByRole('button', { name: `문제 번호 ${position}` })
      )
      return within(await screen.findByRole('dialog')).getByRole('navigation', {
        name: '문제 번호'
      })
    }
    let jump = await openSheet('1 / 3')
    expect(
      within(jump).getByRole('button', { name: '1번, 아직 안 풂' })
    ).toHaveAttribute('aria-current', 'step')
    await user.click(screen.getByRole('button', { name: '창 닫기' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    await user.click(firstRadio)
    jump = await openSheet('1 / 3')
    expect(
      within(jump).getByRole('button', { name: '1번, 답함' })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '창 닫기' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: '다음' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        '2번 문제.'
      )
    )
    expect(screen.getByRole('button', { name: '이전' })).toBeEnabled()
    jump = await openSheet('2 / 3')
    expect(
      within(jump).getByRole('button', { name: '2번, 아직 안 풂' })
    ).toHaveAttribute('aria-current', 'step')
    await user.click(
      within(jump).getByRole('button', { name: '3번, 아직 안 풂' })
    )
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        '3번 문제.'
      )
    )
    expect(
      screen.queryByRole('button', { name: '다음' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '제출하기' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '이전' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        '2번 문제.'
      )
    )
  })

  it('미응답 수를 확인한 뒤 제출하면 결과 경로로 이동한다', async () => {
    // Server drafts are members only (guests keep answers locally).
    await loginAsUser()
    const user = userEvent.setup()
    const payload = await startSession(2)
    const [first] = payload.questions
    const option = first?.options[0]
    if (!option) throw new Error('Public option required')
    const router = renderSession(payload.session.id)
    const radio = await screen.findByRole('radio', {
      name: `1. ${option.text}`
    })
    await waitFor(() => expect(radio).toBeEnabled())
    await user.click(radio)
    await user.click(screen.getByRole('button', { name: '다음' }))
    const submit = await screen.findByRole('button', { name: '제출하기' })
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(
      '아직 안 푼 문제가 1개 있어요. 안 푼 문제는 틀린 것으로 채점돼요.'
    )
    await user.click(within(dialog).getByRole('button', { name: '계속 풀기' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: '제출하기' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '제출하고 결과 보기'
      })
    )
    expect(await screen.findByText('제출 결과 도착')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(
      `/practice/result/${payload.session.id}`
    )
  })

  it('게스트가 답을 골라도 탭 저장소에 남기지 않고 저장 문구도 없다 (F4·F5)', async () => {
    const user = userEvent.setup()
    const payload = await startSession(1)
    const option = payload.questions[0]?.options[0]
    if (!option) throw new Error('Public option required')
    renderSession(payload.session.id)
    const radio = await screen.findByRole('radio', {
      name: `1. ${option.text}`
    })
    await waitFor(() => expect(radio).toBeEnabled())
    await user.click(radio)
    expect(radio).toBeChecked()
    const keys = Object.keys(window.sessionStorage)
    expect(
      keys.filter((key) => key.includes('study-draft-working-copy'))
    ).toEqual([])
    expect(screen.queryByText(/자동으로 저장/u)).not.toBeInTheDocument()
  })

  it('게스트 풀이는 작업본 API를 부르지 않고 화면의 답 그대로 제출한다 (BE #765)', async () => {
    const user = userEvent.setup()
    const payload = await startSession(1)
    const option = payload.questions[0]?.options[0]
    if (!option) throw new Error('Public option required')
    const draftCalls: string[] = []
    let submitted: unknown
    const observe = ({ request }: { request: Request }): void => {
      if (request.url.includes('/draft-answers')) draftCalls.push(request.url)
      if (request.method === 'POST' && /\/submi(t|ssion)$/u.test(request.url)) {
        void request
          .clone()
          .json()
          .then((body: unknown) => {
            submitted = body
          })
      }
    }
    mockServer.events.on('request:start', observe)
    try {
      renderSession(payload.session.id)
      const radio = await screen.findByRole('radio', {
        name: `1. ${option.text}`
      })
      await waitFor(() => expect(radio).toBeEnabled())
      await user.click(radio)
      const submit = screen.getByRole('button', { name: '제출하기' })
      await waitFor(() => expect(submit).toBeEnabled())
      // All answered: no confirm dialog (subtract #9).
      await user.click(submit)
      expect(await screen.findByText('제출 결과 도착')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(submitted).toMatchObject({
        answers: [expect.objectContaining({ selectedOptionId: option.id })]
      })
      // JLP-792: submit no longer sends a draft revision.
      expect(submitted).not.toHaveProperty('expectedDraftRevision')
      expect(draftCalls).toEqual([])
    } finally {
      mockServer.events.removeListener('request:start', observe)
    }
  })

  it('헤더 진행 표시가 현재 번호·전체·답변 수를 따라간다', async () => {
    const user = userEvent.setup()
    const payload = await startSession(3)
    const [first] = payload.questions
    if (!first) throw new Error('Question required')
    renderSession(payload.session.id)
    const firstRadio = await screen.findByRole('radio', {
      name: `1. ${first.options[0]?.text ?? ''}`
    })
    await waitFor(() => expect(firstRadio).toBeEnabled())
    expect(
      screen.getByRole('progressbar', {
        name: '1/3번 · 0문제 답함'
      })
    ).toBeInTheDocument()
    await user.click(firstRadio)
    await user.click(screen.getByRole('button', { name: '다음' }))
    expect(
      await screen.findByRole('progressbar', {
        name: '2/3번 · 1문제 답함'
      })
    ).toBeInTheDocument()
  })

  it('게스트가 풀이 중 나가려 하면 저장되지 않는다고 알리고 계속 풀기에 먼저 초점을 둔다 (G3)', async () => {
    const user = userEvent.setup()
    const payload = await startSession(1)
    const option = payload.questions[0]?.options[0]
    if (!option) throw new Error('Public option required')
    renderSession(payload.session.id)
    const radio = await screen.findByRole('radio', {
      name: `1. ${option.text}`
    })
    await waitFor(() => expect(radio).toBeEnabled())
    await user.click(screen.getByRole('link', { name: '학습 화면으로' }))
    const dialog = await screen.findByRole('dialog', {
      name: '그만 풀까요?'
    })
    expect(
      within(dialog).getByText('나가면 지금 푼 답은 저장되지 않아요.')
    ).toBeVisible()
    expect(
      within(dialog).getByRole('button', { name: '계속 풀기' })
    ).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: '나가기' }))
    expect(await screen.findByText('학습 설정 도착')).toBeInTheDocument()
  })

  it('회원이 풀이 중 나가면 묻지 않고 저장한 뒤 이동한다 (subtract #7)', async () => {
    const user = userEvent.setup()
    await loginAsUser()
    const payload = await startSession(1)
    const option = payload.questions[0]?.options[0]
    if (!option) throw new Error('Public option required')
    renderSession(payload.session.id)
    const radio = await screen.findByRole('radio', {
      name: `1. ${option.text}`
    })
    await waitFor(() => expect(radio).toBeEnabled())
    await user.click(radio)
    await user.click(screen.getByRole('link', { name: '학습 화면으로' }))
    expect(await screen.findByText('학습 설정 도착')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      (await getStudyDraftAnswers(payload.session.id)).data.answers[0]
        ?.selectedOptionId
    ).toBe(option.id)
  })

  it('회원 나가기 저장이 실패하면 머물며 한 줄 오류를 보인다 (subtract #7)', async () => {
    const user = userEvent.setup()
    await loginAsUser()
    const payload = await startSession(1)
    const option = payload.questions[0]?.options[0]
    if (!option) throw new Error('Public option required')
    const router = renderSession(payload.session.id)
    const radio = await screen.findByRole('radio', {
      name: `1. ${option.text}`
    })
    await waitFor(() => expect(radio).toBeEnabled())
    mockServer.use(
      http.put('*/api/v1/study-sessions/:sessionId/draft-answers', () =>
        HttpResponse.json(
          { code: 'SERVER_ERROR', message: 'synthetic draft failure' },
          { status: 500 }
        )
      )
    )
    await user.click(radio)
    await user.click(screen.getByRole('link', { name: '학습 화면으로' }))
    expect(
      await screen.findByText('답을 저장하지 못해서 나가지 않았어요.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe(
      `/practice/session/${payload.session.id}`
    )
    await waitFor(() => expect(radio).toBeEnabled())
  })

  it('보관된 제출 시도가 있으면 beforeunload를 막고 없으면 막지 않는다', async () => {
    const plain = await startSession(1)
    const plainView = renderSession(plain.session.id)
    const plainOption = plain.questions[0]?.options[0]
    if (!plainOption) throw new Error('Public option required')
    await waitFor(() =>
      expect(
        screen.getByRole('radio', { name: `1. ${plainOption.text}` })
      ).toBeEnabled()
    )
    const unfrozen = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unfrozen)
    expect(unfrozen.defaultPrevented).toBe(false)
    plainView.dispose()
    cleanup()

    const frozen = await startSession(1)
    writeStoredSubmissionAttempt(frozen.session.id, {
      logicalRequest: { answers: [], durationSec: 1 },
      idempotencyKey: crypto.randomUUID()
    })
    renderSession(frozen.session.id)
    expect(
      await screen.findByRole('dialog', { name: '제출할까요?' })
    ).toBeInTheDocument()
    const blocked = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(blocked)
    expect(blocked.defaultPrevented).toBe(true)
  })
})

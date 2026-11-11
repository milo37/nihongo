import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import {
  studyResultSchema,
  type StudyResult
} from '@nihongo/contracts/study/study-result'
import { createStudySessionV2 } from '@api/study/createStudySessionV2'
import { getStudyDraftAnswers } from '@api/study/getStudyDraftAnswers'
import { submitStudySessionV2 } from '@api/study/submitStudySessionV2'
import { getStudyResultV1 } from '@api/study/getStudyResultV1'
import { getStudySessionV2 } from '@api/study/getStudySessionV2'
import { commitCanonicalAuth } from '@nihongo/browser/app/login/authSession'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'
import { studyResultQueries } from '@app/practice/queries/studyResultQueries'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'
import { PracticeResultPage } from '@app/practice/result/page'
import { Layout } from '@app/layout'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { AuthErrorHandlerProvider } from '@nihongo/browser/provider/AuthErrorHandlerProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockGuestAllowance } from '@mocks/handlers/guestAllowanceHandlers'
import { mockServer } from '@/test/server'
import {
  readStoredSubmissionAttempt,
  writeStoredSubmissionAttempt
} from '@nihongo/browser/app/practice/submissionAttemptStorage'
import { GUEST_SESSION_QUESTION_LIMIT } from '@nihongo/contracts/study/guest-limits'

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
)
const scrollIntoView = vi.fn()

beforeEach(() => {
  scrollIntoView.mockClear()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView
  })
})

afterEach(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(
      HTMLElement.prototype,
      'scrollIntoView',
      originalScrollIntoView
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
})

const createFixture = async ({
  role = 'USER',
  mixed = true,
  count = 3
}: {
  role?: 'USER' | 'GUEST'
  mixed?: boolean
  count?: number
} = {}) => {
  if (role === 'USER') mockDatabase.loginAs('USER')
  const created = await createStudySessionV2({
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    count
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
  const canonical = await getStudyResultV1(sessionId)
  // Status/fallback cases use a strict published-result fixture from the real
  // canonical SDK response. Retry uses the untouched server result below.
  const result: StudyResult = mixed
    ? {
        ...canonical,
        correctCount: 1,
        incorrectCount: canonical.totalCount - 1,
        correctRate: Math.round(10_000 / canonical.totalCount) / 100,
        items: canonical.items.map((item, index) => ({
          ...item,
          selectedOptionId:
            index === 0
              ? item.question.correctOptionId
              : index === 1
                ? (item.question.options.find(
                    (option) => option.id !== item.question.correctOptionId
                  )?.id ?? null)
                : null,
          isCorrect: index === 0,
          wrongNoteStatus: index === 0 ? null : item.wrongNoteStatus,
          question: {
            ...item.question,
            explanationJa: index === 1 ? 'この問題の日本語の解説です。' : null
          }
        }))
      }
    : canonical
  studyResultSchema.parse(result)
  let resultReads = 0
  mockServer.use(
    http.get(`*/api/v1/study-sessions/${sessionId}/result`, () => {
      resultReads += 1
      return HttpResponse.json(result)
    })
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const principal = await client.fetchQuery(authQueries.currentUser())
  await commitCanonicalAuth(client, principal)
  const mount = (suffix = '') => {
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
          children: [
            {
              path: 'practice/result/:sessionId',
              element: <PracticeResultPage />
            },
            {
              path: 'practice/session/:sessionId',
              element: <h1>재풀이로 이동했습니다</h1>
            }
          ]
        }
      ],
      { initialEntries: [`/practice/result/${sessionId}${suffix}`] }
    )
    const view = render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>
    )
    return { router, view }
  }
  return {
    sessionId,
    result,
    client,
    mount,
    get resultReads() {
      return resultReads
    }
  }
}

describe('approved general result navigation', () => {
  it('preserves a stored attempt when the result and session have unknown 404 ownership', async () => {
    const fixture = await createFixture({ count: 1, mixed: false })
    const oldAttempt = {
      logicalRequest: { answers: [], durationSec: 1 },
      idempotencyKey: crypto.randomUUID()
    }
    writeStoredSubmissionAttempt(fixture.sessionId, oldAttempt)
    let sessionReads = 0
    let resultReads = 0
    const missing = () =>
      HttpResponse.json(
        { code: 'RESOURCE_NOT_FOUND', message: 'synthetic' },
        { status: 404 }
      )
    mockServer.use(
      http.get(`*/api/v1/study-sessions/${fixture.sessionId}`, () => {
        sessionReads += 1
        return missing()
      }),
      http.get(`*/api/v1/study-sessions/${fixture.sessionId}/result`, () => {
        resultReads += 1
        return missing()
      })
    )
    const { view } = fixture.mount()
    expect(
      await screen.findByRole('heading', {
        name: '결과를 찾을 수 없어요'
      })
    ).toBeVisible()
    await waitFor(() => {
      expect(sessionReads).toBeGreaterThan(0)
      expect(resultReads).toBeGreaterThan(0)
    })
    expect(readStoredSubmissionAttempt(fixture.sessionId)).toEqual(oldAttempt)
    view.unmount()
    fixture.client.clear()
  })
  it.each(['ko', 'ja'] as const)(
    'explains an older result link ended without retrying the retired session (%s)',
    async (locale) => {
      writeUiLocalePreference(locale)
      const fixture = await createFixture({ count: 1, mixed: false })
      mockServer.use(
        http.get(`*/api/v1/study-sessions/${fixture.sessionId}`, () =>
          HttpResponse.json(
            {
              code: 'PRACTICE_CONTRACT_VERSION_MISMATCH',
              message: 'old session'
            },
            { status: 409 }
          )
        )
      )
      fixture.mount()
      const title =
        locale === 'ko'
          ? '이 결과는 더 볼 수 없어요'
          : 'この結果はもう見られません'
      expect(await screen.findByRole('heading', { name: title })).toBeVisible()
      expect(
        screen.getByRole('link', {
          name: locale === 'ko' ? '새 문제 풀기' : '新しい問題を解く'
        })
      ).toHaveAttribute('href', '/practice')
    }
  )
  it('정답·오답·미응답 문항 중 선택한 해설만 표시하고 키보드 초점을 유지한다', async () => {
    const fixture = await createFixture()
    const { router, view } = fixture.mount('?keep=1#result-explanations')
    const user = userEvent.setup()
    const [first, second, third] = fixture.result.items
    if (!first || !second || !third)
      throw new Error('결과3 fixture가 필요합니다.')
    const navigation = await screen.findByRole('navigation', {
      name: '문제 번호'
    })
    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    )
    expect(document.getElementById('result-explanations')).toHaveFocus()
    const buttons = within(navigation).getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(buttons[0]).toHaveAccessibleName('1번, 맞음')
    expect(buttons[1]).toHaveAccessibleName('2번, 틀림')
    expect(buttons[2]).toHaveAccessibleName('3번, 안 풂')
    // Shape as well as colour: hollow ○, filled ✕, dashed – (ux2 §2-1).
    expect(
      buttons
        .slice(0, 3)
        .map((button) =>
          button
            .querySelector('.result-status-icon')
            ?.getAttribute('data-status')
        )
    ).toEqual(['correct', 'incorrect', 'unanswered'])
    expect(
      screen.getByRole('heading', { name: first.question.questionText })
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: second.question.questionText })
    ).not.toBeInTheDocument()
    await user.click(buttons[1]!)
    expect(buttons[1]).toHaveFocus()
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('heading', { name: second.question.questionText })
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: first.question.questionText })
    ).not.toBeInTheDocument()
    expect(
      new URLSearchParams(router.state.location.search).get('question')
    ).toBe(second.question.id)
    expect(new URLSearchParams(router.state.location.search).get('keep')).toBe(
      '1'
    )
    expect(router.state.location.hash).toBe('#result-explanations')
    await user.tab()
    expect(buttons[2]).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(buttons[2]).toHaveFocus()
    expect(
      screen.getByRole('heading', { name: third.question.questionText })
    ).toBeVisible()
    expect(fixture.resultReads).toBe(1)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    view.unmount()
    fixture.client.clear()
  })

  it('URL 선택을 재진입에서 복원하고 결과에 없는 문항은 첫 문항으로 처리한다', async () => {
    const fixture = await createFixture()
    const second = fixture.result.items[1]
    const first = fixture.result.items[0]
    if (!first || !second) throw new Error('결과 fixture가 필요합니다.')
    const firstMount = fixture.mount(`?question=${second.question.id}`)
    expect(
      await screen.findByRole('heading', { name: second.question.questionText })
    ).toBeVisible()
    firstMount.view.unmount()
    const restored = fixture.mount(firstMount.router.state.location.search)
    expect(
      await screen.findByRole('heading', { name: second.question.questionText })
    ).toBeVisible()
    await act(async () => {
      await restored.router.navigate('?question=not-in-this-result')
    })
    expect(
      screen.getByRole('heading', { name: first.question.questionText })
    ).toBeVisible()
    expect(
      within(
        screen.getByRole('navigation', { name: '문제 번호' })
      ).getAllByRole('button')[0]
    ).toHaveAttribute('aria-pressed', 'true')
    restored.view.unmount()
    fixture.client.clear()
  })

  it('선택 문항의 JA 해설과 KO fallback을 기존 언어 패널로 제공한다', async () => {
    const fixture = await createFixture()
    const { view } = fixture.mount()
    const user = userEvent.setup()
    const first = fixture.result.items[0]
    const second = fixture.result.items[1]
    if (!first || !second) throw new Error('결과 fixture가 필요합니다.')
    const navigation = await screen.findByRole('navigation', {
      name: '문제 번호'
    })
    expect(screen.getByText(first.question.explanationKo)).toBeVisible()
    await user.click(within(navigation).getAllByRole('button')[1]!)
    await user.click(screen.getByRole('tab', { name: '日本語' }))
    expect(screen.getByText('この問題の日本語の解説です。')).toBeVisible()
    await user.click(within(navigation).getAllByRole('button')[0]!)
    expect(screen.getByText(first.question.explanationKo)).toBeVisible()
    expect(
      screen.queryByRole('tab', { name: '日本語' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('この問題の日本語の解説です。')
    ).not.toBeInTheDocument()
    view.unmount()
    fixture.client.clear()
  })

  it('선택한 문항·버전으로 책갈피를 요청하고 실패 시 선택과 이전 상태를 유지한다', async () => {
    const fixture = await createFixture()
    let body: unknown
    let requestedUrl: string | undefined
    let optimisticBookmark: BookmarkSummary | undefined
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockServer.use(
      http.get('*/api/v1/bookmarks', () =>
        HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 })
      ),
      http.put('*/api/v1/bookmarks/:questionId', async ({ request }) => {
        body = await request.json()
        requestedUrl = request.url
        optimisticBookmark = fixture.client
          .getQueryData(
            bookmarkQueries.list({
              page: 1,
              pageSize: 20,
              questionIds: fixture.result.items.map((item) => item.question.id)
            }).queryKey
          )
          ?.items.find(
            (bookmark) =>
              bookmark.questionId === fixture.result.items[1]?.question.id
          )
        await gate
        return HttpResponse.json(
          {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'temporary failure',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 500 }
        )
      })
    )
    const second = fixture.result.items[1]
    if (!second) throw new Error('결과 fixture가 필요합니다.')
    const { router, view } = fixture.mount(`?question=${second.question.id}`)
    const button = await screen.findByRole('button', {
      name: '2번 문제를 책갈피에 담기'
    })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.setup().click(button)
    // Busy but still focusable, so focus does not fall back to <body>.
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'))
    expect(button).toBeEnabled()
    expect(button).toHaveFocus()
    release()
    expect(
      await screen.findByText('책갈피에 담지 못했어요. 다시 시도해 주세요.')
    ).toBeVisible()
    expect(requestedUrl && new URL(requestedUrl).pathname).toBe(
      `/api/v1/bookmarks/${second.question.id}`
    )
    expect(body).toEqual({})
    expect(optimisticBookmark).toMatchObject({
      questionId: second.question.id,
      question: { questionVersionId: second.question.questionVersionId }
    })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(
      new URLSearchParams(router.state.location.search).get('question')
    ).toBe(second.question.id)
    view.unmount()
    fixture.client.clear()
  })

  it('게스트에게 책갈피는 보이고 누르면 로그인 토스트만, 신고는 숨긴다 (L8·L9·L10)', async () => {
    const fixture = await createFixture({ role: 'GUEST' })
    const { router, view } = fixture.mount()
    await screen.findByRole('navigation', { name: '문제 번호' })
    const bookmark = await screen.findByRole('button', {
      name: /문제를 책갈피에 담기/u
    })
    await userEvent.setup().click(bookmark)
    const toasts = screen.getByRole('region', { name: '알림' })
    expect(
      within(toasts).getByText('책갈피는 로그인하면 쓸 수 있어요.')
    ).toBeVisible()
    expect(within(toasts).queryByText(/이어지지 않아요/u)).toBeNull()
    expect(bookmark).toHaveAttribute('aria-pressed', 'false')
    expect(router.state.location.pathname).toMatch(/^\/practice\/result\//u)
    expect(
      screen.queryByRole('button', { name: /문제 신고/u })
    ).not.toBeInTheDocument()
    // One login place: one ruled line under the score (B4 §4).
    expect(
      screen.getByText('틀린 2문제, 오답노트에 모아 둘까요?')
    ).toBeVisible()
    expect(
      screen.queryByText('로그인하면 방금 푼 문제가 오답노트에 들어가요.')
    ).toBeNull()
    expect(screen.getByRole('link', { name: '로그인' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fwrong-notes'
    )
    expect(screen.getAllByRole('link', { name: /로그인/u })).toHaveLength(1)
    view.unmount()
    fixture.client.clear()
  })

  it('게스트도 틀린 문제만 다시 풀 수 있다 (JLP-823)', async () => {
    const fixture = await createFixture({ role: 'GUEST', mixed: false })
    const { router, view } = fixture.mount()
    const retry = await screen.findByRole('button', {
      name: '틀린 문제만 다시 풀기'
    })
    await waitFor(() => expect(retry).toBeEnabled())
    await userEvent.setup().click(retry)
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/practice\/session\//u)
    )
    view.unmount()
    fixture.client.clear()
  })

  it('게스트의 마지막 시도 결과는 버튼 자리에 한도 카드만 둔다 (JLP-823)', async () => {
    mockGuestAllowance.setRemaining(0)
    const fixture = await createFixture({ role: 'GUEST', mixed: false })
    const { view } = fixture.mount()
    const card = (
      await screen.findByRole('heading', { name: '오늘 3번을 다 풀었어요' })
    ).closest('section') as HTMLElement
    expect(
      within(card).getByRole('button', { name: 'Google로 로그인' })
    ).toBeEnabled()
    expect(within(card).getByText('내일 0시에 다시 3번')).toBeVisible()
    // A retry would be one more try, and the keep line gives way to the card.
    expect(
      screen.queryByRole('button', { name: /틀린 문제만 다시 풀기/u })
    ).toBeNull()
    expect(screen.queryByRole('button', { name: /^다음 \d+문제$/u })).toBeNull()
    expect(document.querySelector('.result-guest-keep')).toBeNull()
    view.unmount()
    fixture.client.clear()
  })

  it('선택은 해설에만 적용되고 재풀이는 실제 전체 오답 집합으로 생성한다', async () => {
    const fixture = await createFixture({ mixed: false })
    const { router, view } = fixture.mount()
    const last = fixture.result.items.at(-1)
    if (!last) throw new Error('결과 fixture가 필요합니다.')
    const navigation = await screen.findByRole('navigation', {
      name: '문제 번호'
    })
    const user = userEvent.setup()
    await user.click(within(navigation).getAllByRole('button').at(-1)!)
    await user.click(
      screen.getByRole('button', { name: '틀린 문제만 다시 풀기' })
    )
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/practice\/session\//)
    )
    const retryId = router.state.location.pathname.split('/').at(-1)
    if (!retryId) throw new Error('재풀이 session id가 필요합니다.')
    const retry = (await getStudySessionV2(retryId)).data
    expect(retry.session.actualCount).toBe(fixture.result.items.length)
    expect(
      retry.questions.map(({ question }) => question.id).toSorted()
    ).toEqual(fixture.result.items.map((item) => item.question.id).toSorted())
    view.unmount()
    fixture.client.clear()
  })

  it('이용이 제한된 계정이 오답 다시 풀기를 누르면 결과 화면에 남아 제한 안내로 초점을 옮긴다', async () => {
    const fixture = await createFixture({ mixed: false })
    const restricted = mockDatabase.getCurrentUser()
    if (!restricted) throw new Error('Signed-in fixture required')
    mockDatabase.setAccountRestricted(restricted.id, true)
    const { router, view } = fixture.mount()
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: '틀린 문제만 다시 풀기' })
    )
    const notice = await screen.findByText(
      '지금은 이용이 잠시 제한된 계정이에요. 제한이 풀리면 다시 학습하고 신고할 수 있어요.'
    )
    await waitFor(() => expect(notice).toHaveFocus())
    expect(router.state.location.pathname).toMatch(/^\/practice\/result\//u)
    expect(screen.queryByText('다시 풀기를 시작하지 못했어요.')).toBeNull()
    view.unmount()
    fixture.client.clear()
  })

  it('background 결과 갱신 실패에서도 선택 해설을 유지하고 결과 기반 동작을 잠근다', async () => {
    const fixture = await createFixture()
    const second = fixture.result.items[1]
    if (!second) throw new Error('결과 fixture가 필요합니다.')
    const { view } = fixture.mount(`?question=${second.question.id}`)
    await screen.findByRole('heading', { name: second.question.questionText })
    mockServer.use(
      http.get(`*/api/v1/study-sessions/${fixture.sessionId}/result`, () =>
        HttpResponse.json(
          {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'temporary failure',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 500 }
        )
      )
    )
    await act(async () => {
      await fixture.client.refetchQueries({
        queryKey: studyResultQueries.result(fixture.sessionId).queryKey,
        exact: true
      })
    })
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: second.question.questionText })
      ).toBeVisible()
      expect(
        screen.getByText(
          '최신 결과를 불러오지 못해 마지막으로 불러온 결과를 보여 드려요. 다시 불러오기 전까지 다시 풀기는 할 수 없어요.'
        )
      ).toBeVisible()
      expect(
        screen.getByRole('button', { name: '틀린 문제만 다시 풀기' })
      ).toBeDisabled()
    })
    view.unmount()
    fixture.client.clear()
  })

  it('모바일 URL·재진입·POP 선택 버튼을 초점 여백 안에 복원하고 세로 이동을 하지 않는다', async () => {
    const fixture = await createFixture({ count: 5 })
    expect(fixture.result.items).toHaveLength(5)
    const first = fixture.result.items[0]!
    const last = fixture.result.items.at(-1)!
    const style = document.createElement('style')
    style.textContent =
      '.study-result-questions { padding-left: 6px; padding-right: 6px; }'
    document.head.append(style)
    const isNavigation = (element: Element): boolean =>
      element.classList.contains('study-result-questions')
    const originalRect = Element.prototype.getBoundingClientRect
    const width = vi
      .spyOn(Element.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: Element) {
        return isNavigation(this) ? 362 : 0
      })
    const scrollWidth = vi
      .spyOn(Element.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: Element) {
        return isNavigation(this) ? 506 : 0
      })
    const rectangles = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        if (isNavigation(this)) return new DOMRect(14, 10, 362, 44)
        const navigation = this.closest('.study-result-questions')
        if (navigation && this instanceof HTMLButtonElement) {
          const index = [...navigation.querySelectorAll('button')].indexOf(this)
          return new DOMRect(
            20 + index * 100 - navigation.scrollLeft,
            10,
            94,
            44
          )
        }
        return originalRect.call(this)
      })
    const scrollTo = vi.spyOn(window, 'scrollTo')
    let mounted = fixture.mount(`?question=${last.question.id}&keep=1`)
    try {
      let navigation = await screen.findByRole('navigation', {
        name: '문제 번호'
      })
      await waitFor(() => expect(navigation.scrollLeft).toBe(144))
      let selected = within(navigation).getByRole('button', {
        name: '5번, 안 풂'
      })
      expect(selected.getBoundingClientRect().right + 6).toBeLessThanOrEqual(
        navigation.getBoundingClientRect().right
      )
      expect(selected).not.toHaveFocus()
      await act(async () => window.dispatchEvent(new Event('resize')))
      expect(navigation.scrollLeft).toBe(144)
      await act(async () => {
        await mounted.router.navigate(`?question=${first.question.id}&keep=1`)
      })
      expect(navigation.scrollLeft).toBe(0)
      await act(async () => {
        await mounted.router.navigate(-1)
      })
      expect(navigation.scrollLeft).toBe(144)
      expect(
        new URLSearchParams(mounted.router.state.location.search).get('keep')
      ).toBe('1')
      const restoredUrl = mounted.router.state.location.search
      mounted.view.unmount()
      mounted = fixture.mount(restoredUrl)
      navigation = await screen.findByRole('navigation', { name: '문제 번호' })
      await waitFor(() => expect(navigation.scrollLeft).toBe(144))
      selected = within(navigation).getByRole('button', {
        name: '5번, 안 풂'
      })
      expect(selected).not.toHaveFocus()
      expect(selected.getBoundingClientRect().right + 6).toBeLessThanOrEqual(
        navigation.getBoundingClientRect().right
      )
      expect(scrollTo).not.toHaveBeenCalled()
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      mounted.view.unmount()
      fixture.client.clear()
      scrollTo.mockRestore()
      rectangles.mockRestore()
      scrollWidth.mockRestore()
      width.mockRestore()
      style.remove()
    }
  })

  it('PC에서 가로 넘침이 없는 선택은 가로 위치나 초점을 바꾸지 않는다', async () => {
    const fixture = await createFixture({ count: 5 })
    const last = fixture.result.items.at(-1)!
    const width = vi
      .spyOn(Element.prototype, 'clientWidth', 'get')
      .mockReturnValue(190)
    const scrollWidth = vi
      .spyOn(Element.prototype, 'scrollWidth', 'get')
      .mockReturnValue(190)
    const scrollTo = vi.spyOn(window, 'scrollTo')
    const { view } = fixture.mount(`?question=${last.question.id}`)
    try {
      const navigation = await screen.findByRole('navigation', {
        name: '문제 번호'
      })
      expect(navigation.scrollLeft).toBe(0)
      await act(async () => window.dispatchEvent(new Event('resize')))
      expect(navigation.scrollLeft).toBe(0)
      expect(
        within(navigation).getByRole('button', { name: '5번, 안 풂' })
      ).not.toHaveFocus()
      expect(scrollTo).not.toHaveBeenCalled()
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      view.unmount()
      fixture.client.clear()
      scrollTo.mockRestore()
      scrollWidth.mockRestore()
      width.mockRestore()
    }
  })

  it('요약은 점수·정답률·시간·미응답을 한 번만 보이고, 해설 확인·오늘은 여기까지가 없다 (ux2 §2-2·2-3)', async () => {
    const fixture = await createFixture()
    const { view } = fixture.mount()
    // The score sentence is the page heading (B4 §11).
    const score = await screen.findByRole('heading', { level: 1 })
    expect(score).toHaveTextContent(/^3문제 중 1개 맞음$/u)
    expect(score.querySelector('b')).toHaveTextContent(/^1$/u)
    // Rate, time and unanswered sit once in the line under the score (B4).
    expect(score.nextElementSibling).toHaveTextContent(
      /정답률 33\.33% · 0분 0초 · 안 풂 1$/u
    )
    expect(
      screen.getByText('안 푼 문제도 틀린 것으로 채점돼요.', {
        exact: false
      })
    ).toBeVisible()
    // No second set of the same numbers (the old five metrics).
    expect(score?.parentElement?.querySelector('dl')).toBeNull()
    expect(
      screen.getByText('틀린 2문제를 오답노트에 담았어요.')
    ).toBeInTheDocument()
    expect(screen.queryByText('해설 확인하기')).toBeNull()
    expect(screen.queryByText('오늘은 여기까지')).toBeNull()
    expect(screen.queryByRole('link', { name: '오답노트 보기' })).toBeNull()
    expect(
      screen.getByRole('button', { name: '틀린 문제만 다시 풀기' })
    ).toBeEnabled()
    view.unmount()
    fixture.client.clear()
  })

  it('모두 맞힌 결과는 안내 상자 없이 다음 10문제(주) 하나만 보여 준다', async () => {
    const fixture = await createFixture()
    const allCorrect: StudyResult = {
      ...fixture.result,
      correctCount: fixture.result.totalCount,
      incorrectCount: 0,
      correctRate: 100,
      items: fixture.result.items.map((item) => ({
        ...item,
        selectedOptionId: item.question.correctOptionId,
        isCorrect: true,
        wrongNoteStatus: null
      }))
    }
    studyResultSchema.parse(allCorrect)
    mockServer.use(
      http.get(`*/api/v1/study-sessions/${fixture.sessionId}/result`, () =>
        HttpResponse.json(allCorrect)
      )
    )
    const { view } = fixture.mount()
    const next = await screen.findByRole('button', { name: '다음 10문제' })
    expect(next.className).toContain('bg-brand')
    const actions = next.closest<HTMLElement>('.study-result-actions')
    expect(
      Array.from(actions!.querySelectorAll('a, button')).map((element) =>
        element.textContent?.trim()
      )
    ).toEqual(['다음 10문제'])
    expect(screen.queryByText('다시 풀 오답이 없어요')).toBeNull()
    expect(screen.queryByRole('link', { name: '새 문제 풀기' })).toBeNull()
    view.unmount()
    fixture.client.clear()
  })

  it.each([
    [
      'NO_ELIGIBLE_QUESTIONS',
      422,
      '지금 다시 풀 수 있는 틀린 문제가 없어요',
      false
    ],
    ['INTERNAL_SERVER_ERROR', 500, '다시 풀기를 시작하지 못했어요.', true]
  ] as const)(
    '재출제 실패 %s는 결과 화면에 머물며 안내를 보여 준다',
    async (code, status, message, keepsRetryButton) => {
      const fixture = await createFixture()
      mockServer.use(
        http.post('*/api/v1/study-sessions/:sessionId/retry', () =>
          HttpResponse.json(
            { code, message: 'synthetic', requestId: crypto.randomUUID() },
            { status }
          )
        )
      )
      const { router, view } = fixture.mount()
      const user = userEvent.setup()
      await user.click(
        await screen.findByRole('button', { name: '틀린 문제만 다시 풀기' })
      )
      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(router.state.location.pathname).toBe(
        `/practice/result/${fixture.sessionId}`
      )
      expect(
        screen.queryByRole('button', { name: '틀린 문제만 다시 풀기' }) !== null
      ).toBe(keepsRetryButton)
      view.unmount()
      fixture.client.clear()
    }
  )

  it('회원 다음에 할 일은 다음 10문제(주)와 오답 다시 풀기(테두리) 두 개뿐이다 (B4 §11)', async () => {
    const actionsOf = (element: HTMLElement): HTMLElement => {
      const actions = element.closest<HTMLElement>('.study-result-actions')
      if (!actions) throw new Error('결과 동작 영역이 필요합니다.')
      return actions
    }
    const names = (actions: HTMLElement): string[] =>
      Array.from(actions.querySelectorAll<HTMLElement>('a, button')).map(
        (element) => element.textContent?.trim() ?? ''
      )
    const member = await createFixture()
    const memberView = member.mount()
    const retry = await screen.findByRole('button', {
      name: '틀린 문제만 다시 풀기'
    })
    const actions = actionsOf(retry)
    // The subhead stays for screen readers only.
    expect(
      within(actions).getByRole('heading', { level: 2, name: '다음에 할 일' })
    ).toHaveClass('sr-only')
    expect(names(actions)).toEqual(['다음 10문제', '틀린 문제만 다시 풀기'])
    expect(retry.className).toContain('border-line-interactive')
    expect(retry.className).not.toContain('bg-brand')
    const next = within(actions).getByRole('button', { name: '다음 10문제' })
    expect(next.className).toContain('bg-brand')
    expect(next.className).toContain('h-12')
    expect(within(actions).queryByRole('link')).toBeNull()
    memberView.view.unmount()
    member.client.clear()
  })

  it('다음 10문제는 한 번 눌러 같은 급수·과목의 새 랜덤 학습을 시작한다', async () => {
    const member = await createFixture()
    const { router, view } = member.mount()
    let body: unknown = null
    mockServer.use(
      http.post('*/api/v1/study-sessions', async ({ request }) => {
        body = await request.clone().json()
        return undefined
      })
    )
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: '다음 10문제' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/practice\/session\//u)
    )
    expect(body).toEqual({
      level: 'N5',
      subject: 'VOCABULARY',
      count: 10,
      mode: 'RANDOM'
    })
    view.unmount()
    member.client.clear()
  })

  it('다음 10문제가 거절되면 결과 화면에 머물며 이유를 그 자리에서 알린다', async () => {
    const member = await createFixture()
    const { router, view } = member.mount()
    mockServer.use(
      http.post('*/api/v1/study-sessions', () =>
        HttpResponse.json(
          {
            code: 'NO_ELIGIBLE_QUESTIONS',
            message: '문제가 없습니다.',
            requestId: crypto.randomUUID(),
            retryable: false
          },
          { status: 404 }
        )
      )
    )
    const resultPath = router.state.location.pathname
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: '다음 10문제' }))
    expect(
      await screen.findByText(
        "지금 조건으로는 '랜덤'에서 풀 수 있는 문제가 없어요."
      )
    ).toBeVisible()
    expect(router.state.location.pathname).toBe(resultPath)
    view.unmount()
    member.client.clear()
  })

  it('게스트 다음에 할 일도 다음 N문제(주)와 다시 풀기(테두리) 두 개뿐이다 (B4 §11)', async () => {
    const guest = await createFixture({ role: 'GUEST', mixed: false })
    const guestView = guest.mount()
    const guestRetry = await screen.findByRole('button', {
      name: '틀린 문제만 다시 풀기'
    })
    const guestActions = guestRetry.closest<HTMLElement>(
      '.study-result-actions'
    )
    if (!guestActions) throw new Error('결과 동작 영역이 필요합니다.')
    expect(
      Array.from(guestActions.querySelectorAll<HTMLElement>('a, button')).map(
        (element) => element.textContent?.trim() ?? ''
      )
    ).toEqual([
      // The guest's tries left ride inside the button (plan-notes §5).
      `다음 ${GUEST_SESSION_QUESTION_LIMIT}문제2번 남음`,
      '틀린 문제만 다시 풀기'
    ])
    expect(guestRetry.className).toContain('border-line-interactive')
    expect(guestRetry.className).not.toContain('bg-brand')
    expect(
      within(guestActions).getByRole('button', {
        name: new RegExp(`^다음 ${GUEST_SESSION_QUESTION_LIMIT}문제`, 'u')
      }).className
    ).toContain('bg-brand')
    expect(guestRetry.querySelector('svg')).toBeNull()
    guestView.view.unmount()
    guest.client.clear()
  })

  it('게스트가 다 맞히면 다음부터 모인다는 한 줄과 로그인 링크만 둔다', async () => {
    const fixture = await createFixture({ role: 'GUEST' })
    const allCorrect = {
      ...fixture.result,
      correctCount: fixture.result.totalCount,
      incorrectCount: 0,
      correctRate: 100,
      items: fixture.result.items.map((item) => ({
        ...item,
        selectedOptionId: item.question.correctOptionId,
        isCorrect: true,
        wrongNoteStatus: null
      }))
    }
    mockServer.use(
      http.get(`*/api/v1/study-sessions/${fixture.sessionId}/result`, () =>
        HttpResponse.json(allCorrect)
      )
    )
    const { view } = fixture.mount()
    const line = await screen.findByText(
      /^로그인하면 다음부터 틀린 문제가 오답노트에 모여요\./u
    )
    expect(within(line).getByRole('link', { name: '로그인' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fpractice'
    )
    expect(screen.queryByText(/모아 둘까요/u)).toBeNull()
    view.unmount()
    fixture.client.clear()
  })

  it('책갈피 저장에 성공하면 성공 안내와 눌린 상태를 보여 준다', async () => {
    const fixture = await createFixture()
    const second = fixture.result.items[1]
    if (!second) throw new Error('결과 fixture가 필요합니다.')
    const { view } = fixture.mount(`?question=${second.question.id}`)
    const button = await screen.findByRole('button', {
      name: '2번 문제를 책갈피에 담기'
    })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.setup().click(button)
    const toasts = await screen.findByRole('region', { name: '알림' })
    expect(await within(toasts).findByText('책갈피에 담았어요.')).toBeVisible()
    expect(
      screen.getByRole('button', { name: '2번 문제를 책갈피에서 빼기' })
    ).toHaveAttribute('aria-pressed', 'true')
    view.unmount()
    fixture.client.clear()
  })
})

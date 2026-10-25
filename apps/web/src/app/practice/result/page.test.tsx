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
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'

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
  it('정답·오답·미응답 문항 중 선택한 해설만 표시하고 키보드 초점을 유지한다', async () => {
    const fixture = await createFixture()
    const { router, view } = fixture.mount('?keep=1#result-explanations')
    const user = userEvent.setup()
    const [first, second, third] = fixture.result.items
    if (!first || !second || !third)
      throw new Error('결과3 fixture가 필요합니다.')
    const navigation = await screen.findByRole('navigation', {
      name: '해설 문항'
    })
    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    )
    expect(document.getElementById('result-explanations')).toHaveFocus()
    const buttons = within(navigation).getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(buttons[0]).toHaveAccessibleName('문제 1 · 정답')
    expect(buttons[1]).toHaveAccessibleName('문제 2 · 오답')
    expect(buttons[2]).toHaveAccessibleName('문제 3 · 미응답')
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
        screen.getByRole('navigation', { name: '해설 문항' })
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
      name: '해설 문항'
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
      name: '2번 문제 책갈피 추가'
    })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.setup().click(button)
    expect(
      await screen.findByText(
        '책갈피를 저장하지 못해 이전 상태로 복원했습니다.'
      )
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

  it('게스트도 탐색·해설을 읽되 회원 책갈피·신고 동작을 노출하지 않는다', async () => {
    const fixture = await createFixture({ role: 'GUEST' })
    const { view } = fixture.mount()
    await screen.findByRole('navigation', { name: '해설 문항' })
    expect(
      screen.queryByRole('button', { name: /문제 책갈피/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        '현재 게스트 세션에서는 오답을 다시 풀 수 있지만 계정 오답노트에는 저장되지 않습니다.'
      )
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '로그인 선택' })).toBeVisible()
    view.unmount()
    fixture.client.clear()
  })

  it('선택은 해설에만 적용되고 재풀이는 실제 전체 오답 집합으로 생성한다', async () => {
    const fixture = await createFixture({ mixed: false })
    const { router, view } = fixture.mount()
    const last = fixture.result.items.at(-1)
    if (!last) throw new Error('결과 fixture가 필요합니다.')
    const navigation = await screen.findByRole('navigation', {
      name: '해설 문항'
    })
    const user = userEvent.setup()
    await user.click(within(navigation).getAllByRole('button').at(-1)!)
    await user.click(screen.getByRole('button', { name: '오답만 다시 풀기' }))
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
    expect(
      screen.getByRole('heading', { name: second.question.questionText })
    ).toBeVisible()
    expect(
      screen.getByText(
        '최신 결과로 갱신하지 못해 마지막으로 확인한 결과를 표시합니다. 다시 확인할 때까지 결과 기반 동작은 잠깁니다.'
      )
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: '오답만 다시 풀기' })
    ).toBeDisabled()
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
        name: '해설 문항'
      })
      await waitFor(() => expect(navigation.scrollLeft).toBe(144))
      let selected = within(navigation).getByRole('button', {
        name: '문제 5 · 미응답'
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
      navigation = await screen.findByRole('navigation', { name: '해설 문항' })
      await waitFor(() => expect(navigation.scrollLeft).toBe(144))
      selected = within(navigation).getByRole('button', {
        name: '문제 5 · 미응답'
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
        name: '해설 문항'
      })
      expect(navigation.scrollLeft).toBe(0)
      await act(async () => window.dispatchEvent(new Event('resize')))
      expect(navigation.scrollLeft).toBe(0)
      expect(
        within(navigation).getByRole('button', { name: '문제 5 · 미응답' })
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
})

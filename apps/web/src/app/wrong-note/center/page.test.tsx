import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reviewCenterConformanceFixture } from '@nihongo/contracts/testing/review-center-conformance'
import { WrongNoteReviewCenterPage } from '@app/wrong-note/center/page'
import { mockServer } from '@/test/server'

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

const createClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })

const renderCenter = (
  initialEntry: string | string[]
): {
  client: QueryClient
  router: ReturnType<typeof createMemoryRouter>
  unmount: () => void
} => {
  const initialEntries = Array.isArray(initialEntry)
    ? initialEntry
    : [initialEntry]
  const client = createClient()
  const router = createMemoryRouter(
    [
      { path: '/wrong-notes', element: <WrongNoteReviewCenterPage /> },
      {
        path: '/practice/session/:sessionId',
        element: <h1>복습 세션 화면</h1>
      }
    ],
    { initialEntries, initialIndex: initialEntries.length - 1 }
  )
  const rendered = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { client, router, unmount: rendered.unmount }
}

const emptyQueue = {
  ...reviewCenterConformanceFixture.queue,
  items: [],
  total: 0,
  counts: { due: 0, unreviewed: 0, repeated: 0, solved: 0 }
}

const dailySession = {
  ...reviewCenterConformanceFixture.targetedSession,
  session: {
    ...reviewCenterConformanceFixture.targetedSession.session,
    mode: 'DAILY_REVIEW' as const,
    requestedCount: 10,
    actualCount: 1
  }
}

describe('WrongNoteReviewCenterPage', () => {
  afterEach(() => {
    onlineManager.setOnline(true)
    vi.restoreAllMocks()
  })

  it('shows an offline state instead of an indefinite cold-loading spinner', async () => {
    onlineManager.setOnline(false)
    const { client, unmount } = renderCenter('/wrong-notes')

    expect(
      await screen.findByText(
        /현재 URL 조건으로 복습 대기열을 자동으로 다시 불러옵니다/u
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText('복습 대기열을 불러오고 있습니다.')
    ).not.toBeInTheDocument()
    unmount()
    client.clear()
  })

  it('canonicalizes invalid URL state and corrects a zero-total page without offering a batch', async () => {
    mockServer.use(
      http.get('*/api/v1/review-queue', () => HttpResponse.json(emptyQueue))
    )
    const { client, router } = renderCenter(
      '/wrong-notes?view=DUE&level=N5&subject=VOCABULARY&tag=%EC%97%86%EB%8A%94%ED%83%9C%EA%B7%B8&page=99&owner=x'
    )

    await waitFor(() =>
      expect(router.state.location.search).toBe(
        '?level=N5&subject=VOCABULARY&tag=%EC%97%86%EB%8A%94%ED%83%9C%EA%B7%B8'
      )
    )
    expect(
      await screen.findByRole('heading', {
        name: '지금 예정된 복습이 없습니다'
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: '조건에 맞는 오늘의 복습 시작'
      })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '태그' })).toHaveValue(
      '없는태그'
    )
    expect(screen.getByRole('link', { name: '전체 기록' })).toHaveAttribute(
      'href',
      '/wrong-notes/history'
    )
    client.clear()
  })

  it('preserves a valid page restored by browser back while its larger result is pending', async () => {
    const pageTwoGate = createDeferred()
    let pageTwoStarted = false
    mockServer.use(
      http.get('*/api/v1/review-queue', async ({ request }) => {
        const page = new URL(request.url).searchParams.get('page')
        if (page === '2') {
          pageTwoStarted = true
          await pageTwoGate.promise
          return HttpResponse.json({
            ...reviewCenterConformanceFixture.queue,
            page: 2,
            total: 21
          })
        }
        return HttpResponse.json({
          ...reviewCenterConformanceFixture.queue,
          page: 1,
          total: 1
        })
      })
    )
    const { client, router, unmount } = renderCenter([
      '/wrong-notes?page=2',
      '/wrong-notes?view=SOLVED'
    ])
    await screen.findByRole('heading', { name: '조건에 맞는 오답 1개' })

    await act(async () => router.navigate(-1))
    await waitFor(() => expect(pageTwoStarted).toBe(true))
    expect(router.state.location.search).toBe('?page=2')
    expect(
      screen.queryByText('유효한 복습 대기열 페이지로 이동하고 있습니다…')
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '조건에 맞는 오답 1개' })
    ).toBeVisible()
    expect(
      screen.getByText('복습 대기열 페이지를 갱신하고 있습니다…')
    ).toHaveAttribute('role', 'status')
    expect(document.querySelector('ul[aria-busy="true"]')).not.toBeNull()

    await act(async () => pageTwoGate.release())
    expect(
      await screen.findByRole('heading', { name: '조건에 맞는 오답 21개' })
    ).toBeVisible()
    expect(router.state.location.search).toBe('?page=2')
    expect(
      screen.queryByText('복습 대기열 페이지를 갱신하고 있습니다…')
    ).not.toBeInTheDocument()
    expect(document.querySelector('ul[aria-busy="true"]')).toBeNull()
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('2')
    unmount()
    client.clear()
  })

  it('does not offer a batch from placeholder results for a pending filter', async () => {
    const user = userEvent.setup()
    const filteredGate = createDeferred()
    let filteredRequestStarted = false
    mockServer.use(
      http.get('*/api/v1/review-queue', async ({ request }) => {
        const questionType = new URL(request.url).searchParams.get(
          'questionType'
        )
        if (questionType === 'KANJI_READING') {
          filteredRequestStarted = true
          await filteredGate.promise
        }
        return HttpResponse.json(reviewCenterConformanceFixture.queue)
      })
    )
    const { client, router, unmount } = renderCenter(
      '/wrong-notes?level=N5&subject=VOCABULARY'
    )
    await screen.findByRole('button', {
      name: '조건에 맞는 오늘의 복습 시작'
    })

    await user.selectOptions(
      screen.getByRole('combobox', { name: '문제 유형' }),
      'KANJI_READING'
    )
    await waitFor(() => expect(filteredRequestStarted).toBe(true))
    expect(router.state.location.search).toContain('questionType=KANJI_READING')
    expect(
      screen.queryByRole('button', {
        name: '조건에 맞는 오늘의 복습 시작'
      })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('복습 대기열 페이지를 갱신하고 있습니다…')
    ).toHaveAttribute('role', 'status')

    await act(async () => filteredGate.release())
    expect(
      await screen.findByRole('button', {
        name: '조건에 맞는 오늘의 복습 시작'
      })
    ).toBeEnabled()
    unmount()
    client.clear()
  })

  it('keeps a controlled filter focused across consecutive keyboard selections', async () => {
    const user = userEvent.setup()
    mockServer.use(
      http.get('*/api/v1/review-queue', () =>
        HttpResponse.json(reviewCenterConformanceFixture.queue)
      )
    )
    const { client, router } = renderCenter('/wrong-notes')

    await screen.findByRole('heading', { name: '조건에 맞는 오답 1개' })
    const questionType = screen.getByRole('combobox', { name: '문제 유형' })
    questionType.focus()

    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(router.state.location.search).toBe('?questionType=KANJI_READING')
    )
    expect(questionType).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(router.state.location.search).toBe('?questionType=ORTHOGRAPHY')
    )
    expect(questionType).toHaveFocus()
    client.clear()
  })

  it('suppresses stale empty and batch UI while correcting a nonzero out-of-range page', async () => {
    const pageOneGate = createDeferred()
    let pageOneStarted = false
    mockServer.use(
      http.get('*/api/v1/review-queue', async ({ request }) => {
        const page = new URL(request.url).searchParams.get('page')
        if (page === '99') {
          return HttpResponse.json({
            ...reviewCenterConformanceFixture.queue,
            items: [],
            page: 99
          })
        }
        pageOneStarted = true
        await pageOneGate.promise
        return HttpResponse.json(reviewCenterConformanceFixture.queue)
      })
    )
    const { client } = renderCenter(
      '/wrong-notes?level=N5&subject=VOCABULARY&page=99'
    )

    await waitFor(() => expect(pageOneStarted).toBe(true))
    expect(
      screen.queryByRole('heading', { name: '지금 예정된 복습이 없습니다' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: '조건에 맞는 오늘의 복습 시작'
      })
    ).not.toBeInTheDocument()

    await act(async () => pageOneGate.release())
    expect(
      await screen.findByRole('heading', { name: '조건에 맞는 오답 1개' })
    ).toBeInTheDocument()
    client.clear()
  })

  it('starts a DAILY batch with server-selected filters and no question IDs', async () => {
    const user = userEvent.setup()
    let observedBody: unknown
    mockServer.use(
      http.get('*/api/v1/review-queue', () =>
        HttpResponse.json(reviewCenterConformanceFixture.queue)
      ),
      http.post('*/api/v1/study-sessions', async ({ request }) => {
        observedBody = await request.json()
        return HttpResponse.json(dailySession, {
          status: 201,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Nihongo-Practice-Contract': '2'
          }
        })
      })
    )
    const { client } = renderCenter(
      '/wrong-notes?level=N5&subject=VOCABULARY&questionType=KANJI_READING&tag=%ED%95%9C%EC%9E%90+%EC%9D%BD%EA%B8%B0'
    )

    await screen.findByRole('heading', { name: '조건에 맞는 오답 1개' })
    await user.click(
      screen.getByRole('button', {
        name: '조건에 맞는 오늘의 복습 시작'
      })
    )

    expect(
      await screen.findByRole('heading', { name: '복습 세션 화면' })
    ).toBeInTheDocument()
    expect(observedBody).toEqual({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'DAILY_REVIEW',
      count: 10,
      reviewFilter: {
        questionType: 'KANJI_READING',
        tag: '한자 읽기'
      }
    })
    expect(JSON.stringify(observedBody)).not.toContain('questionId')
    client.clear()
  })

  it('keeps cached results but disables batch start until a failed background refresh recovers', async () => {
    const user = userEvent.setup()
    let requestCount = 0
    mockServer.use(
      http.get('*/api/v1/review-queue', () => {
        requestCount += 1
        if (requestCount === 2) {
          return HttpResponse.json(
            {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'temporary queue error',
              requestId: crypto.randomUUID(),
              retryable: true
            },
            { status: 500 }
          )
        }
        return HttpResponse.json(reviewCenterConformanceFixture.queue)
      })
    )
    const { client } = renderCenter('/wrong-notes?level=N5&subject=VOCABULARY')
    await screen.findByRole('heading', { name: '조건에 맞는 오답 1개' })

    await act(async () => {
      await client.invalidateQueries()
    })
    expect(
      await screen.findByText(/복습 대기열의 최신 상태를 확인하지 못했습니다/u)
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        reviewCenterConformanceFixture.queue.items[0].questionPreview
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: '조건에 맞는 오늘의 복습 시작'
      })
    ).toBeDisabled()

    await user.click(
      screen.getByRole('button', { name: '복습 대기열 다시 확인' })
    )
    await waitFor(() =>
      expect(
        screen.queryByText(/복습 대기열의 최신 상태를 확인하지 못했습니다/u)
      ).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole('button', {
        name: '조건에 맞는 오늘의 복습 시작'
      })
    ).toBeEnabled()
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: '지금 복습할 오답을 확인하세요' })
      ).toHaveFocus()
    )
    expect(requestCount).toBe(3)
    client.clear()
  })

  it('clears a stale no-eligible error when the batch filter changes', async () => {
    const user = userEvent.setup()
    mockServer.use(
      http.get('*/api/v1/review-queue', () =>
        HttpResponse.json(reviewCenterConformanceFixture.queue)
      ),
      http.post('*/api/v1/study-sessions', () =>
        HttpResponse.json(
          {
            code: 'NO_ELIGIBLE_QUESTIONS',
            message: '현재 조건으로 출제할 문제가 없습니다.',
            requestId: crypto.randomUUID(),
            retryable: false
          },
          { status: 404 }
        )
      )
    )
    const { client } = renderCenter('/wrong-notes?level=N5&subject=VOCABULARY')
    await screen.findByRole('heading', { name: '조건에 맞는 오답 1개' })
    await user.click(
      screen.getByRole('button', {
        name: '조건에 맞는 오늘의 복습 시작'
      })
    )
    expect(
      await screen.findByText('현재 조건으로 출제 가능한 복습 문제가 없습니다.')
    ).toBeInTheDocument()

    await user.selectOptions(
      screen.getByRole('combobox', { name: '문제 유형' }),
      'WORD_USAGE'
    )
    await waitFor(() =>
      expect(
        screen.queryByText('현재 조건으로 출제 가능한 복습 문제가 없습니다.')
      ).not.toBeInTheDocument()
    )
    client.clear()
  })

  it('keeps the selected batch context and reports an offline create without transport', async () => {
    const user = userEvent.setup()
    let postCount = 0
    mockServer.use(
      http.get('*/api/v1/review-queue', () =>
        HttpResponse.json(reviewCenterConformanceFixture.queue)
      ),
      http.post('*/api/v1/study-sessions', () => {
        postCount += 1
        return HttpResponse.json(dailySession, { status: 201 })
      })
    )
    const { client } = renderCenter('/wrong-notes?level=N5&subject=VOCABULARY')
    await screen.findByRole('heading', { name: '조건에 맞는 오답 1개' })
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    await user.click(
      screen.getByRole('button', {
        name: '조건에 맞는 오늘의 복습 시작'
      })
    )
    expect(
      await screen.findByText(
        '오프라인에서는 복습 세션을 만들 수 없습니다. 연결 후 같은 조건으로 다시 시도해 주세요.'
      )
    ).toBeInTheDocument()
    expect(postCount).toBe(0)
    expect(screen.getByRole('combobox', { name: '급수' })).toHaveValue('N5')
    expect(screen.getByRole('combobox', { name: '과목' })).toHaveValue(
      'VOCABULARY'
    )
    online.mockRestore()
    client.clear()
  })

  it('restores URL-backed view state through browser history', async () => {
    const user = userEvent.setup()
    mockServer.use(
      http.get('*/api/v1/review-queue', () =>
        HttpResponse.json(reviewCenterConformanceFixture.queue)
      )
    )
    const { client, router } = renderCenter('/wrong-notes')
    await screen.findByRole('heading', { name: '조건에 맞는 오답 1개' })

    await user.click(screen.getByRole('button', { name: /반복 오답/u }))
    await waitFor(() =>
      expect(router.state.location.search).toBe('?view=REPEATED')
    )
    await user.click(screen.getByRole('button', { name: /해결/u }))
    await waitFor(() =>
      expect(router.state.location.search).toBe('?view=SOLVED')
    )

    await act(async () => {
      await router.navigate(-1)
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /반복 오답/u })
      ).toHaveAttribute('aria-pressed', 'true')
    )
    client.clear()
  })
})

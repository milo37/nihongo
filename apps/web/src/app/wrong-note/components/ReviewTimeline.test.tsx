import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { reviewCenterConformanceFixture } from '@nihongo/contracts/testing/review-center-conformance'
import { encodeReviewEventCursor } from '@nihongo/contracts/wrong-note/list-review-events'
import { ReviewTimeline } from '@app/wrong-note/components/ReviewTimeline'
import { useListReviewEvents } from '@app/wrong-note/hooks/useListReviewEvents'
import { mockServer } from '@/test/server'

const createClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })

const createWrapper =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

const TimelineHarness = (): ReactElement => {
  const historyQuery = useListReviewEvents(
    reviewCenterConformanceFixture.memo.questionId,
    1
  )
  return <ReviewTimeline historyQuery={historyQuery} />
}

describe('ReviewTimeline', () => {
  afterEach(() => {
    onlineManager.setOnline(true)
  })

  it('retains prior events on cursor failure and focuses the newly loaded event after retry', async () => {
    const user = userEvent.setup()
    const [newerEvent, olderEvent] =
      reviewCenterConformanceFixture.history.items
    const nextCursor = encodeReviewEventCursor({
      v: 1,
      occurredAt: newerEvent.occurredAt,
      id: newerEvent.id
    })
    let cursorRequestCount = 0
    mockServer.use(
      http.get(
        '*/api/v1/wrong-notes/:questionId/review-events',
        ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor')
          if (!cursor) {
            return HttpResponse.json({
              items: [newerEvent],
              nextCursor
            })
          }
          cursorRequestCount += 1
          if (cursorRequestCount === 1) {
            return HttpResponse.json(
              {
                code: 'SERVICE_UNAVAILABLE',
                message: '잠시 후 다시 시도해 주세요.',
                requestId: crypto.randomUUID(),
                retryable: true
              },
              { status: 503 }
            )
          }
          return HttpResponse.json({ items: [olderEvent], nextCursor: null })
        }
      )
    )
    const client = createClient()
    render(<TimelineHarness />, { wrapper: createWrapper(client) })

    expect(await screen.findByText('오답 복습 제출')).toBeInTheDocument()
    const loadMore = screen.getByRole('button', {
      name: '이전 기록 더 보기'
    })
    await user.click(loadMore)
    expect(
      await screen.findByText(/현재까지 불러온 기록은 유지됩니다/u)
    ).toBeInTheDocument()
    expect(screen.getByText('오답 복습 제출')).toBeInTheDocument()
    await waitFor(() => expect(loadMore).toHaveFocus())

    await user.click(loadMore)
    const olderSource = await screen.findByText('표준 학습 제출')
    const olderItem = olderSource.closest('li')
    if (!olderItem) throw new Error('복습 이벤트 list item이 필요합니다.')
    await waitFor(() => expect(olderItem).toHaveFocus())
    expect(cursorRequestCount).toBe(2)
    expect(
      screen.getByText('첫 오답 기록까지 모두 확인했습니다.')
    ).toBeInTheDocument()
    client.clear()
  })

  it('restores focus to the first event after an initial-load retry', async () => {
    const user = userEvent.setup()
    let requestCount = 0
    mockServer.use(
      http.get('*/api/v1/wrong-notes/:questionId/review-events', () => {
        requestCount += 1
        if (requestCount === 1) {
          return HttpResponse.json(
            {
              code: 'INTERNAL_SERVER_ERROR',
              message: '잠시 후 다시 시도해 주세요.',
              requestId: crypto.randomUUID(),
              retryable: true
            },
            { status: 500 }
          )
        }
        return HttpResponse.json(reviewCenterConformanceFixture.history)
      })
    )
    const client = createClient()
    render(<TimelineHarness />, { wrapper: createWrapper(client) })

    await screen.findByText('복습 기록을 불러오지 못했습니다.')
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    const firstSource = await screen.findByText('오답 복습 제출')
    const firstItem = firstSource.closest('li')
    if (!firstItem) throw new Error('복습 이벤트 list item이 필요합니다.')
    await waitFor(() => expect(firstItem).toHaveFocus())
    client.clear()
  })

  it('keeps loaded events and resumes the same cursor request after reconnect', async () => {
    const user = userEvent.setup()
    const [newerEvent, olderEvent] =
      reviewCenterConformanceFixture.history.items
    const nextCursor = encodeReviewEventCursor({
      v: 1,
      occurredAt: newerEvent.occurredAt,
      id: newerEvent.id
    })
    let cursorRequestCount = 0
    mockServer.use(
      http.get(
        '*/api/v1/wrong-notes/:questionId/review-events',
        ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor')
          if (!cursor) {
            return HttpResponse.json({
              items: [newerEvent],
              nextCursor
            })
          }
          cursorRequestCount += 1
          return HttpResponse.json({ items: [olderEvent], nextCursor: null })
        }
      )
    )
    const client = createClient()
    render(<TimelineHarness />, { wrapper: createWrapper(client) })
    await screen.findByText('오답 복습 제출')
    onlineManager.setOnline(false)

    await user.click(screen.getByRole('button', { name: '이전 기록 더 보기' }))
    expect(
      await screen.findByText(
        /현재 기록을 유지하며 연결되면 중단된 요청을 이어갑니다/u
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '연결 대기 중…' })).toBeDisabled()
    expect(screen.getByText('오답 복습 제출')).toBeInTheDocument()
    expect(cursorRequestCount).toBe(0)

    act(() => onlineManager.setOnline(true))
    const olderSource = await screen.findByText('표준 학습 제출')
    const olderItem = olderSource.closest('li')
    if (!olderItem) throw new Error('복습 이벤트 list item이 필요합니다.')
    await waitFor(() => expect(olderItem).toHaveFocus())
    expect(cursorRequestCount).toBe(1)
    client.clear()
  })

  it('keeps cached events on background refresh failure and focuses the first event after retry', async () => {
    const user = userEvent.setup()
    let requestCount = 0
    mockServer.use(
      http.get('*/api/v1/wrong-notes/:questionId/review-events', () => {
        requestCount += 1
        if (requestCount === 2) {
          return HttpResponse.json(
            {
              code: 'INTERNAL_SERVER_ERROR',
              message: '잠시 후 다시 시도해 주세요.',
              requestId: crypto.randomUUID(),
              retryable: true
            },
            { status: 500 }
          )
        }
        return HttpResponse.json(reviewCenterConformanceFixture.history)
      })
    )
    const client = createClient()
    render(<TimelineHarness />, { wrapper: createWrapper(client) })
    const firstSource = await screen.findByText('오답 복습 제출')

    await act(async () => {
      await client.invalidateQueries()
    })
    expect(
      await screen.findByText(/복습 기록의 최신 상태를 확인하지 못했습니다/u)
    ).toBeInTheDocument()
    expect(firstSource).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: '복습 기록 다시 확인' })
    )
    await waitFor(() =>
      expect(
        screen.queryByText(/복습 기록의 최신 상태를 확인하지 못했습니다/u)
      ).not.toBeInTheDocument()
    )
    const firstItem = firstSource.closest('li')
    if (!firstItem) throw new Error('복습 이벤트 list item이 필요합니다.')
    await waitFor(() => expect(firstItem).toHaveFocus())
    expect(requestCount).toBe(3)
    client.clear()
  })

  it('marks a cached empty history as stale and focuses the first event after recovery', async () => {
    const user = userEvent.setup()
    let requestCount = 0
    mockServer.use(
      http.get('*/api/v1/wrong-notes/:questionId/review-events', () => {
        requestCount += 1
        if (requestCount === 1) {
          return HttpResponse.json({ items: [], nextCursor: null })
        }
        if (requestCount === 2) {
          return HttpResponse.json(
            {
              code: 'INTERNAL_SERVER_ERROR',
              message: '잠시 후 다시 시도해 주세요.',
              requestId: crypto.randomUUID(),
              retryable: true
            },
            { status: 500 }
          )
        }
        return HttpResponse.json(reviewCenterConformanceFixture.history)
      })
    )
    const client = createClient()
    render(<TimelineHarness />, { wrapper: createWrapper(client) })
    expect(
      await screen.findByText('아직 복습 이벤트가 없습니다.')
    ).toBeInTheDocument()

    await act(async () => {
      await client.invalidateQueries()
    })
    expect(
      await screen.findByText(/복습 기록의 최신 상태를 확인하지 못했습니다/u)
    ).toBeInTheDocument()
    expect(screen.getByText('아직 복습 이벤트가 없습니다.')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: '복습 기록 다시 확인' })
    )
    const firstSource = await screen.findByText('오답 복습 제출')
    const firstItem = firstSource.closest('li')
    if (!firstItem) throw new Error('복습 이벤트 list item이 필요합니다.')
    await waitFor(() => expect(firstItem).toHaveFocus())
    expect(requestCount).toBe(3)
    client.clear()
  })
})

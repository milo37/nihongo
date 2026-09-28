import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { BookmarkPage } from '@app/bookmark/page'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'
import { mockServer } from '@/test/server'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

type DeleteSettlement = 'FAILURE' | 'REMOVE' | 'REPLACE'

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

const createBookmark = (index: number, label?: string): BookmarkSummary => {
  const questionId = crypto.randomUUID()
  return {
    availability: 'AVAILABLE',
    createdAt: new Date(
      Date.UTC(2026, 7, 21, 12, 0, 0) - index * 1_000
    ).toISOString(),
    questionId,
    question: {
      difficulty: 'EASY',
      id: questionId,
      level: 'N5',
      questionTextPreview: label ?? `즐겨찾기 문제 ${index}`,
      questionType: 'KANJI_READING',
      questionVersionId: crypto.randomUUID(),
      subject: 'VOCABULARY',
      tags: [{ id: crypto.randomUUID(), label: '한자 읽기' }]
    }
  }
}

const createClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })

const renderBookmarkPage = (
  client: QueryClient = createClient()
): {
  client: QueryClient
  unmount: () => void
} => {
  const router = createMemoryRouter(
    [{ path: '/bookmarks', element: <BookmarkPage /> }],
    { initialEntries: ['/bookmarks'] }
  )
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { client, unmount: view.unmount }
}

const renderLastPageDelete = async () => {
  const initialItems = Array.from({ length: 21 }, (_, index) =>
    createBookmark(index + 1)
  )
  const lastItem = initialItems[20]
  if (!lastItem) throw new Error('Bookmark page fixture가 필요합니다.')
  const replacement = createBookmark(22, '동시에 추가된 즐겨찾기')
  const settlement = createDeferred<DeleteSettlement>()
  let serverItems = initialItems

  mockServer.use(
    http.get('*/api/v1/bookmarks', ({ request }) => {
      const searchParams = new URL(request.url).searchParams
      const page = Number(searchParams.get('page') ?? '1')
      const pageSize = Number(searchParams.get('pageSize') ?? '20')
      const offset = (page - 1) * pageSize
      return HttpResponse.json({
        items: serverItems.slice(offset, offset + pageSize),
        page,
        pageSize,
        total: serverItems.length
      })
    }),
    http.delete('*/api/v1/bookmarks/:questionId', async () => {
      const result = await settlement.promise
      if (result === 'FAILURE') {
        return HttpResponse.json(
          {
            code: 'INTERNAL_SERVER_ERROR',
            message: '즐겨찾기 해제에 실패했습니다.',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 500 }
        )
      }
      serverItems = serverItems.filter(
        ({ questionId }) => questionId !== lastItem.questionId
      )
      if (result === 'REPLACE') serverItems = [...serverItems, replacement]
      return new HttpResponse(null, {
        status: 204,
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Request-Id': crypto.randomUUID()
        }
      })
    })
  )

  const client = createClient()
  const router = createMemoryRouter(
    [{ path: '/bookmarks', element: <BookmarkPage /> }],
    { initialEntries: ['/bookmarks'] }
  )
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  const user = userEvent.setup()

  await screen.findByText('1 / 2 페이지')
  await user.click(screen.getByRole('button', { name: '다음' }))
  await screen.findByText(lastItem.question.questionTextPreview)
  expect(screen.getByText('2 / 2 페이지')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '즐겨찾기 해제' }))
  await screen.findByText('이 페이지가 비었습니다')

  return {
    client,
    lastItem,
    replacement,
    settlement,
    unmount: view.unmount
  }
}

const dispose = (client: QueryClient, unmount: () => void): void => {
  unmount()
  client.clear()
}

describe('BookmarkPage pagination settlement', () => {
  afterEach(() => {
    onlineManager.setOnline(true)
  })

  it('cold offline에서 무한 loading 대신 자동 재개 상태를 표시한다', async () => {
    onlineManager.setOnline(false)
    const fixture = renderBookmarkPage()

    expect(
      await screen.findByRole('heading', {
        name: '오프라인에서 즐겨찾기를 기다리고 있습니다'
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByText('즐겨찾기를 불러오고 있습니다…')
    ).not.toBeInTheDocument()
    dispose(fixture.client, fixture.unmount)
  })

  it('cached refetch 실패에서도 현재 목록을 유지하고 재시도를 제공한다', async () => {
    const cachedItem = createBookmark(1, '캐시에 남은 즐겨찾기')
    const client = createClient()
    const query = bookmarkQueries.list({ page: 1, pageSize: 20 })
    client.setQueryData(query.queryKey, {
      items: [cachedItem],
      page: 1,
      pageSize: 20,
      total: 1
    })
    await client.invalidateQueries({
      exact: true,
      queryKey: query.queryKey,
      refetchType: 'none'
    })
    mockServer.use(
      http.get('*/api/v1/bookmarks', () =>
        HttpResponse.json(
          {
            code: 'SERVICE_UNAVAILABLE',
            message: 'temporary error',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 503 }
        )
      )
    )
    const fixture = renderBookmarkPage(client)

    expect(await screen.findByText('캐시에 남은 즐겨찾기')).toBeVisible()
    expect(
      await screen.findByText(
        '즐겨찾기의 최신 상태를 확인하지 못했습니다. 현재 목록은 유지됩니다.'
      )
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeEnabled()
    dispose(fixture.client, fixture.unmount)
  })

  it('cached 목록이 offline이면 uncached 페이지로 이동하지 못하게 잠근다', async () => {
    const cachedItems = Array.from({ length: 20 }, (_, index) =>
      createBookmark(index + 1)
    )
    const client = createClient()
    const query = bookmarkQueries.list({ page: 1, pageSize: 20 })
    client.setQueryData(query.queryKey, {
      items: cachedItems,
      page: 1,
      pageSize: 20,
      total: 21
    })
    await client.invalidateQueries({
      exact: true,
      queryKey: query.queryKey,
      refetchType: 'none'
    })
    act(() => onlineManager.setOnline(false))

    const fixture = renderBookmarkPage(client)

    expect(await screen.findByText('1 / 2 페이지')).toBeVisible()
    expect(
      screen.getByText(
        '오프라인입니다. 현재 목록을 유지하며 연결되면 중단된 요청을 이어갑니다.'
      )
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled()
    dispose(fixture.client, fixture.unmount)
  })

  it('마지막 페이지 delete 실패 중에는 page를 유지하고 rollback 항목을 복원한다', async () => {
    const fixture = await renderLastPageDelete()

    await act(async () => fixture.settlement.resolve('FAILURE'))

    expect(
      await screen.findByText(fixture.lastItem.question.questionTextPreview)
    ).toBeInTheDocument()
    expect(screen.getByText('2 / 2 페이지')).toBeInTheDocument()
    expect(
      screen.getByText(
        '즐겨찾기 해제를 완료하지 못해 이전 상태로 복원했습니다.'
      )
    ).toBeVisible()
    dispose(fixture.client, fixture.unmount)
  })

  it('마지막 항목 delete 성공 후 canonical total이 줄면 page 1로 clamp한다', async () => {
    const fixture = await renderLastPageDelete()

    await act(async () => fixture.settlement.resolve('REMOVE'))

    await waitFor(() =>
      expect(screen.getByText('1 / 1 페이지')).toBeInTheDocument()
    )
    expect(
      screen.queryByText(fixture.lastItem.question.questionTextPreview)
    ).not.toBeInTheDocument()
    dispose(fixture.client, fixture.unmount)
  })

  it('optimistic total은 줄어도 canonical 동시 추가로 page 2가 남으면 clamp하지 않는다', async () => {
    const fixture = await renderLastPageDelete()

    await act(async () => fixture.settlement.resolve('REPLACE'))

    expect(
      await screen.findByText(fixture.replacement.question.questionTextPreview)
    ).toBeInTheDocument()
    expect(screen.getByText('2 / 2 페이지')).toBeInTheDocument()
    dispose(fixture.client, fixture.unmount)
  })
})

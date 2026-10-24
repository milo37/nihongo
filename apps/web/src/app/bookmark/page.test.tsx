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
      questionTextPreview: label ?? `책갈피 문제 ${index}`,
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
  router: ReturnType<typeof createMemoryRouter>
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
  return { client, router, unmount: view.unmount }
}

const renderLastPageDelete = async (
  activation: 'pointer' | 'keyboard' = 'pointer'
) => {
  const initialItems = Array.from({ length: 21 }, (_, index) =>
    createBookmark(index + 1)
  )
  const lastItem = initialItems[20]
  if (!lastItem) throw new Error('Bookmark page fixture가 필요합니다.')
  const replacement = createBookmark(22, '동시에 추가된 책갈피')
  const settlement = createDeferred<DeleteSettlement>()
  let serverItems = initialItems
  let deleteRequests = 0

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
      deleteRequests += 1
      const result = await settlement.promise
      if (result === 'FAILURE') {
        return HttpResponse.json(
          {
            code: 'INTERNAL_SERVER_ERROR',
            message: '책갈피 해제에 실패했습니다.',
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
  await user.click(screen.getByRole('link', { name: '다음 페이지' }))
  expect(router.state.location.search).toBe('?page=2')
  await screen.findByText(lastItem.question.questionTextPreview)
  expect(screen.getByText('2 / 2 페이지')).toBeInTheDocument()
  const removalTrigger = screen.getByRole('button', { name: '책갈피 해제' })
  if (activation === 'keyboard') {
    removalTrigger.focus()
    await user.keyboard('{Enter}')
  } else {
    await user.click(removalTrigger)
  }
  expect(
    screen.getByRole('heading', { name: '책갈피를 해제할까요?' })
  ).toBeVisible()
  const confirm = screen.getByRole('button', { name: '해제 확인' })
  if (activation === 'keyboard') {
    await user.tab({ shift: true })
    expect(confirm).toHaveFocus()
    await user.keyboard('{Enter}')
  } else {
    await user.click(confirm)
  }
  await screen.findByText('이 페이지가 비었습니다')
  expect(removalTrigger.isConnected).toBe(false)

  return {
    client,
    lastItem,
    replacement,
    removalTrigger,
    settlement,
    get deleteRequests() {
      return deleteRequests
    },
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

  it('전체 건수와 긴 미리보기 펼침을 제공하고 읽기만으로 변경하지 않는다', async () => {
    const preview = '長い文を最後まで読む。'.repeat(12)
    const item = createBookmark(1, preview)
    let readCount = 0
    mockServer.use(
      http.get('*/api/v1/bookmarks', () => {
        readCount += 1
        return HttpResponse.json({
          items: [
            item,
            ...Array.from({ length: 19 }, (_, index) =>
              createBookmark(index + 2)
            )
          ],
          page: 1,
          pageSize: 20,
          total: 21
        })
      })
    )
    const fixture = renderBookmarkPage()
    const interaction = userEvent.setup()
    const summary = (await screen.findByText(preview)).closest('summary')
    if (!summary) throw new Error('미리보기 summary가 필요합니다.')
    const details = summary.closest('details')
    expect(screen.getByRole('status', { name: '전체 21개' })).toHaveTextContent(
      '21'
    )
    expect(screen.getByText(preview)).toBeInTheDocument()
    expect(details).not.toHaveAttribute('open')
    await interaction.click(summary)
    expect(details).toHaveAttribute('open')
    expect(details?.querySelector('p')).toHaveTextContent(
      '저장된 문항 미리보기예요.'
    )
    await interaction.click(summary)
    expect(details).not.toHaveAttribute('open')
    expect(readCount).toBe(1)
    dispose(fixture.client, fixture.unmount)
  })

  it('cold offline에서 무한 loading 대신 자동 재개 상태를 표시한다', async () => {
    onlineManager.setOnline(false)
    const fixture = renderBookmarkPage()

    expect(
      await screen.findByRole('heading', {
        name: '오프라인에서 책갈피를 기다리고 있습니다'
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByText('책갈피를 불러오고 있습니다…')
    ).not.toBeInTheDocument()
    dispose(fixture.client, fixture.unmount)
  })

  it('cached refetch 실패에서도 현재 목록을 유지하고 재시도를 제공한다', async () => {
    const cachedItem = createBookmark(1, '캐시에 남은 책갈피')
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

    expect(await screen.findByText('캐시에 남은 책갈피')).toBeVisible()
    expect(
      await screen.findByText(
        '책갈피의 최신 상태를 확인하지 못했습니다. 현재 목록은 유지됩니다.'
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
    expect(screen.getByRole('link', { name: '이전 페이지' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByRole('link', { name: '다음 페이지' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    dispose(fixture.client, fixture.unmount)
  })

  it('keeps the activated link during fetch and focuses the current number after response', async () => {
    const items = Array.from({ length: 21 }, (_, index) =>
      createBookmark(index + 1)
    )
    const pageTwoGate = createDeferred<void>()
    mockServer.use(
      http.get('*/api/v1/bookmarks', async ({ request }) => {
        const page = Number(
          new URL(request.url).searchParams.get('page') ?? '1'
        )
        if (page === 2) await pageTwoGate.promise
        return HttpResponse.json({
          items: page === 1 ? items.slice(0, 20) : items.slice(20),
          page,
          pageSize: 20,
          total: items.length
        })
      })
    )
    const fixture = renderBookmarkPage()
    const interaction = userEvent.setup()
    const next = await screen.findByRole('link', { name: '다음 페이지' })

    await interaction.click(next)
    expect(fixture.router.state.location.search).toBe('?page=2')
    expect(screen.getByRole('link', { name: '다음 페이지' })).toBe(next)
    expect(next).toHaveFocus()
    expect(
      screen.getByText(items[0]?.question.questionTextPreview ?? '')
    ).toBeVisible()
    expect(
      screen.getByText('책갈피 페이지를 갱신하고 있습니다…')
    ).toHaveAttribute('role', 'status')
    expect(
      screen
        .getByText(items[0]?.question.questionTextPreview ?? '')
        .closest('[aria-busy]')
    ).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('1')

    await act(async () => pageTwoGate.resolve())
    expect(
      await screen.findByText(items[20]?.question.questionTextPreview ?? '')
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '다음 페이지' })).toBe(next)
    expect(screen.getByRole('link', { current: 'page' })).toHaveFocus()
    expect(next).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.queryByText('책갈피 페이지를 갱신하고 있습니다…')
    ).not.toBeInTheDocument()
    expect(screen.getByText('2 / 2 페이지')).toBeInTheDocument()
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('2')
    dispose(fixture.client, fixture.unmount)
  })

  it('keeps the activated URL pagination link focused when a cold page fetch fails', async () => {
    const items = Array.from({ length: 20 }, (_, index) =>
      createBookmark(index + 1)
    )
    const pageTwoGate = createDeferred<void>()
    mockServer.use(
      http.get('*/api/v1/bookmarks', async ({ request }) => {
        const page = Number(
          new URL(request.url).searchParams.get('page') ?? '1'
        )
        if (page === 2) {
          await pageTwoGate.promise
          return HttpResponse.json(
            {
              code: 'SERVICE_UNAVAILABLE',
              message: 'temporary error',
              requestId: crypto.randomUUID(),
              retryable: true
            },
            { status: 503 }
          )
        }
        return HttpResponse.json({
          items,
          page,
          pageSize: 20,
          total: 21
        })
      })
    )
    const fixture = renderBookmarkPage()
    const interaction = userEvent.setup()
    const next = await screen.findByRole('link', { name: '다음 페이지' })

    await interaction.click(next)
    expect(fixture.router.state.location.search).toBe('?page=2')
    expect(screen.getByRole('link', { name: '다음 페이지' })).toBe(next)
    expect(next).toHaveFocus()

    await act(async () => pageTwoGate.resolve())
    const errorHeading = await screen.findByRole('heading', {
      name: '책갈피를 불러오지 못했습니다'
    })
    expect(errorHeading).toHaveFocus()
    expect(screen.queryByRole('link', { name: '다음 페이지' })).toBeNull()
    dispose(fixture.client, fixture.unmount)
  })

  it('asks before removal and returns focus without a DELETE when cancelled', async () => {
    const item = createBookmark(1, '확인 후 해제할 책갈피')
    let deleteCount = 0
    mockServer.use(
      http.get('*/api/v1/bookmarks', () =>
        HttpResponse.json({
          items: [item],
          page: 1,
          pageSize: 20,
          total: 1
        })
      ),
      http.delete('*/api/v1/bookmarks/:questionId', () => {
        deleteCount += 1
        return new HttpResponse(null, { status: 204 })
      })
    )
    const fixture = renderBookmarkPage()
    const interaction = userEvent.setup()
    const trigger = await screen.findByRole('button', {
      name: '책갈피 해제'
    })

    await interaction.click(trigger)
    expect(
      screen.getByRole('heading', { name: '책갈피를 해제할까요?' })
    ).toBeVisible()
    await interaction.click(screen.getByRole('button', { name: '계속 보관' }))

    await waitFor(() => expect(trigger).toHaveFocus())
    expect(deleteCount).toBe(0)
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
      screen.getByText('책갈피 해제를 완료하지 못해 이전 상태로 복원했습니다.')
    ).toBeVisible()
    const restoredTrigger = screen.getByRole('button', { name: '책갈피 해제' })
    expect(restoredTrigger).not.toBe(fixture.removalTrigger)
    await waitFor(() => expect(restoredTrigger).toHaveFocus())
    dispose(fixture.client, fixture.unmount)
  })

  it('returns focus to the same row when removal is cancelled without a request', async () => {
    const item = createBookmark(1)
    let deleteRequests = 0
    mockServer.use(
      http.get('*/api/v1/bookmarks', () =>
        HttpResponse.json({ items: [item], page: 1, pageSize: 20, total: 1 })
      ),
      http.delete('*/api/v1/bookmarks/:questionId', () => {
        deleteRequests += 1
        return new HttpResponse(null, { status: 204 })
      })
    )
    const fixture = renderBookmarkPage()
    const user = userEvent.setup()
    const trigger = await screen.findByRole('button', { name: '책갈피 해제' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: '계속 보관' }))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(deleteRequests).toBe(0)
    expect(screen.getByText(item.question.questionTextPreview)).toBeVisible()
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

  it('키보드 해제 확인 실패 후 복원된 해제 버튼으로 초점을 돌려준다', async () => {
    const fixture = await renderLastPageDelete('keyboard')

    await act(async () => fixture.settlement.resolve('FAILURE'))

    expect(
      await screen.findByText(fixture.lastItem.question.questionTextPreview)
    ).toBeVisible()
    expect(screen.getByText('2 / 2 페이지')).toBeInTheDocument()
    expect(
      screen.getByText('책갈피 해제를 완료하지 못해 이전 상태로 복원했습니다.')
    ).toBeVisible()
    const restoredTrigger = screen.getByRole('button', { name: '책갈피 해제' })
    expect(restoredTrigger).not.toBe(fixture.removalTrigger)
    await waitFor(() => expect(restoredTrigger).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fixture.deleteRequests).toBe(1)
    dispose(fixture.client, fixture.unmount)
  })
})

it('displays one real bookmark page without adding unsupported filters', async () => {
  const item = createBookmark(1)
  mockServer.use(
    http.get('*/api/v1/bookmarks', () =>
      HttpResponse.json({ items: [item], page: 1, pageSize: 20, total: 1 })
    )
  )
  const fixture = renderBookmarkPage()
  await screen.findByText(item.question.questionTextPreview)
  expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('1')
  for (const label of [
    '첫 페이지',
    '이전 페이지',
    '다음 페이지',
    '마지막 페이지'
  ])
    expect(screen.getByRole('link', { name: label })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  dispose(fixture.client, fixture.unmount)
})

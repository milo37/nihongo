import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import type { ListBookmarksResponse } from '@nihongo/contracts/bookmark/list-bookmarks'
import { QueryClient } from '@tanstack/react-query'
import {
  optimisticallyCreateBookmark,
  optimisticallyDeleteBookmark,
  rollbackOptimisticCreateBookmark,
  rollbackOptimisticDeleteBookmark,
  restoreBookmarkCache,
  snapshotBookmarkCache
} from '@app/bookmark/hooks/bookmarkOptimisticCache'
import {
  bookmarkQueries,
  normalizeBookmarkListQuery
} from '@app/bookmark/queries/bookmarkQueries'

const id = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${index.toString(16).padStart(12, '0')}`

const createBookmark = (index: number): BookmarkSummary => ({
  questionId: id(index),
  question: {
    id: id(index),
    questionVersionId: id(index + 100),
    level: 'N5',
    subject: 'VOCABULARY',
    questionType: 'KANJI_READING',
    difficulty: 'EASY',
    questionTextPreview: `${index}번 문제`,
    tags: [{ id: id(index + 200), label: '태그' }]
  },
  availability: 'AVAILABLE',
  createdAt: `2026-08-21T00:00:${String(index).padStart(2, '0')}.000Z`
})

const createPage = (
  items: BookmarkSummary[],
  total = items.length,
  page = 1,
  pageSize = 20
): ListBookmarksResponse => ({ items, page, pageSize, total })

describe('bookmark Query key와 optimistic cache', () => {
  it('coercion 뒤 questionIds를 canonical sort·dedupe한 동일 key로 만든다', () => {
    const left = normalizeBookmarkListQuery({
      page: '2',
      pageSize: '10',
      questionIds: [id(2), id(1).toUpperCase(), id(1)]
    })
    const right = normalizeBookmarkListQuery({
      page: 2,
      pageSize: 10,
      questionIds: [id(1), id(2)]
    })

    expect(left).toEqual(right)
    expect(bookmarkQueries.list(left).queryKey).toEqual(
      bookmarkQueries.list(right).queryKey
    )
  })

  it('create는 batch/page total을 갱신하고 rollback snapshot을 정확히 복원한다', () => {
    const client = new QueryClient()
    const bookmark = createBookmark(1)
    const pageTwoKey = bookmarkQueries.list({ page: 2, pageSize: 1 }).queryKey
    const batchKey = bookmarkQueries.list({
      questionIds: [bookmark.questionId]
    }).queryKey
    const pageTwo = createPage([createBookmark(2)], 2, 2, 1)
    const emptyBatch = createPage([])
    client.setQueryData(pageTwoKey, pageTwo)
    client.setQueryData(batchKey, emptyBatch)
    const snapshot = snapshotBookmarkCache(client)

    optimisticallyCreateBookmark(client, bookmark)

    expect(client.getQueryData<ListBookmarksResponse>(pageTwoKey)).toEqual({
      ...pageTwo,
      total: 3
    })
    expect(client.getQueryData<ListBookmarksResponse>(batchKey)).toEqual(
      createPage([bookmark], 1)
    )

    restoreBookmarkCache(client, snapshot)
    expect(client.getQueryData(pageTwoKey)).toEqual(pageTwo)
    expect(client.getQueryData(batchKey)).toEqual(emptyBatch)
  })

  it('가득 찬 첫 페이지 create rollback은 밀려난 마지막 항목을 복원한다', () => {
    const client = new QueryClient()
    const previousItems = Array.from({ length: 20 }, (_, index) =>
      createBookmark(index + 1)
    ).toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
    const listKey = bookmarkQueries.list().queryKey
    const previous = createPage(previousItems, 20)
    const optimistic = createBookmark(21)
    client.setQueryData(listKey, previous)

    const patch = optimisticallyCreateBookmark(client, optimistic)
    expect(
      client
        .getQueryData<ListBookmarksResponse>(listKey)
        ?.items.some(
          ({ questionId }) => questionId === previousItems.at(-1)?.questionId
        )
    ).toBe(false)

    rollbackOptimisticCreateBookmark(client, patch)
    expect(client.getQueryData(listKey)).toEqual(previous)
  })

  it('filtered cache에 없는 ID delete는 total을 훼손하지 않는다', () => {
    const client = new QueryClient()
    const missing = createBookmark(1)
    const retained = createBookmark(2)
    const batchKey = bookmarkQueries.list({
      questionIds: [missing.questionId, retained.questionId]
    }).queryKey
    client.setQueryData(batchKey, createPage([retained], 1))

    optimisticallyDeleteBookmark(client, missing.questionId)

    expect(client.getQueryData<ListBookmarksResponse>(batchKey)).toEqual(
      createPage([retained], 1)
    )
  })

  it('다른 filtered page에서 확인된 Bookmark delete는 모든 page total에 반영한다', () => {
    const client = new QueryClient()
    const first = createBookmark(1)
    const second = createBookmark(2)
    const filter = [first.questionId, second.questionId]
    const firstPageKey = bookmarkQueries.list({
      page: 1,
      pageSize: 1,
      questionIds: filter
    }).queryKey
    const secondPageKey = bookmarkQueries.list({
      page: 2,
      pageSize: 1,
      questionIds: filter
    }).queryKey
    client.setQueryData(firstPageKey, createPage([first], 2, 1, 1))
    client.setQueryData(secondPageKey, createPage([second], 2, 2, 1))

    optimisticallyDeleteBookmark(client, first.questionId)

    expect(
      client.getQueryData<ListBookmarksResponse>(firstPageKey)
    ).toMatchObject({ items: [], total: 1 })
    expect(
      client.getQueryData<ListBookmarksResponse>(secondPageKey)
    ).toMatchObject({ items: [second], total: 1 })
  })

  it('겹친 다른 문항 optimistic 변경은 한 요청 rollback 뒤에도 보존한다', () => {
    const client = new QueryClient()
    const first = createBookmark(1)
    const second = createBookmark(2)
    const third = createBookmark(3)
    const listKey = bookmarkQueries.list().queryKey
    client.setQueryData(listKey, createPage([first, second], 2))

    const deleteSnapshot = snapshotBookmarkCache(client)
    optimisticallyDeleteBookmark(client, first.questionId)
    const createPatch = optimisticallyCreateBookmark(client, third)

    rollbackOptimisticDeleteBookmark(client, deleteSnapshot, first.questionId)
    expect(client.getQueryData<ListBookmarksResponse>(listKey)).toMatchObject({
      items: expect.arrayContaining([first, second, third]),
      total: 3
    })

    rollbackOptimisticCreateBookmark(client, createPatch)
    expect(client.getQueryData<ListBookmarksResponse>(listKey)).toEqual(
      createPage([second, first], 2)
    )
  })

  it('create 뒤 시작한 다른 문항 delete는 create rollback이 되살리지 않는다', () => {
    const client = new QueryClient()
    const first = createBookmark(1)
    const second = createBookmark(2)
    const optimistic = createBookmark(3)
    const listKey = bookmarkQueries.list().queryKey
    client.setQueryData(listKey, createPage([second, first], 2))

    const createPatch = optimisticallyCreateBookmark(client, optimistic)
    optimisticallyDeleteBookmark(client, second.questionId)
    rollbackOptimisticCreateBookmark(client, createPatch)

    expect(client.getQueryData<ListBookmarksResponse>(listKey)).toEqual(
      createPage([first], 1)
    )
  })
})

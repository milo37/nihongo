import type { BookmarkSummary } from '@nihongo/contracts/bookmark/bookmark'
import type { ListBookmarksResponse } from '@nihongo/contracts/bookmark/list-bookmarks'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import {
  bookmarkQueries,
  type NormalizedBookmarkListQuery
} from '@app/bookmark/queries/bookmarkQueries'

export interface BookmarkCacheSnapshot {
  entries: Array<[QueryKey, ListBookmarksResponse | undefined]>
}

interface BookmarkCreatePatchEntry {
  displacedItems: BookmarkSummary[]
  queryKey: QueryKey
}

export interface BookmarkCreatePatch {
  entries: BookmarkCreatePatchEntry[]
  questionId: string
}

const readQuery = (queryKey: QueryKey): NormalizedBookmarkListQuery | null => {
  const value = queryKey[2]
  if (!value || typeof value !== 'object') return null
  if (!('page' in value) || !('pageSize' in value)) return null
  if (typeof value.page !== 'number' || typeof value.pageSize !== 'number') {
    return null
  }
  const questionIds =
    'questionIds' in value && Array.isArray(value.questionIds)
      ? value.questionIds.filter(
          (questionId): questionId is string => typeof questionId === 'string'
        )
      : undefined
  return {
    page: value.page,
    pageSize: value.pageSize,
    ...(questionIds ? { questionIds } : {})
  }
}

export const snapshotBookmarkCache = (
  queryClient: QueryClient
): BookmarkCacheSnapshot => ({
  entries: queryClient.getQueriesData<ListBookmarksResponse>({
    queryKey: bookmarkQueries.listsKey()
  })
})

export const restoreBookmarkCache = (
  queryClient: QueryClient,
  snapshot: BookmarkCacheSnapshot
): void => {
  snapshot.entries.forEach(([queryKey, data]) => {
    queryClient.setQueryData(queryKey, data)
  })
}

const readSnapshotData = (
  snapshot: BookmarkCacheSnapshot,
  queryKey: QueryKey
): ListBookmarksResponse | undefined =>
  snapshot.entries.find(
    ([candidateKey]) =>
      JSON.stringify(candidateKey) === JSON.stringify(queryKey)
  )?.[1]

const sortBookmarks = (
  bookmarks: BookmarkSummary[],
  pageSize: number
): BookmarkSummary[] =>
  bookmarks
    .toSorted(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        left.questionId.localeCompare(right.questionId)
    )
    .slice(0, pageSize)

export const optimisticallyCreateBookmark = (
  queryClient: QueryClient,
  bookmark: BookmarkSummary
): BookmarkCreatePatch => {
  const snapshot = snapshotBookmarkCache(queryClient)
  const wasKnownBookmarked = snapshot.entries.some(([, data]) =>
    data?.items.some((item) => item.questionId === bookmark.questionId)
  )
  const patch: BookmarkCreatePatch = {
    entries: [],
    questionId: bookmark.questionId
  }
  if (wasKnownBookmarked) return patch

  snapshot.entries.forEach(([queryKey, data]) => {
    const query = readQuery(queryKey)
    if (!query || !data) return
    if (query.questionIds && !query.questionIds.includes(bookmark.questionId)) {
      return
    }
    const items =
      query.page === 1
        ? [...data.items, bookmark]
            .toSorted(
              (left, right) =>
                right.createdAt.localeCompare(left.createdAt) ||
                left.questionId.localeCompare(right.questionId)
            )
            .slice(0, query.pageSize)
        : data.items
    const visibleQuestionIds = new Set(items.map((item) => item.questionId))
    patch.entries.push({
      displacedItems: data.items.filter(
        (item) => !visibleQuestionIds.has(item.questionId)
      ),
      queryKey
    })
    queryClient.setQueryData<ListBookmarksResponse>(queryKey, {
      ...data,
      items,
      total: data.total + 1
    })
  })
  return patch
}

export const optimisticallyDeleteBookmark = (
  queryClient: QueryClient,
  questionId: string
): void => {
  const snapshot = snapshotBookmarkCache(queryClient)
  const wasKnownBookmarked = snapshot.entries.some(([, data]) =>
    data?.items.some((item) => item.questionId === questionId)
  )
  snapshot.entries.forEach(([queryKey, data]) => {
    if (!data) return
    const query = readQuery(queryKey)
    const counted = query?.questionIds
      ? wasKnownBookmarked && query.questionIds.includes(questionId)
      : wasKnownBookmarked && data.total > 0
    queryClient.setQueryData<ListBookmarksResponse>(queryKey, {
      ...data,
      items: data.items.filter((item) => item.questionId !== questionId),
      total: counted ? Math.max(0, data.total - 1) : data.total
    })
  })
}

export const rollbackOptimisticCreateBookmark = (
  queryClient: QueryClient,
  patch: BookmarkCreatePatch
): void => {
  patch.entries.forEach(({ displacedItems, queryKey }) => {
    const current = queryClient.getQueryData<ListBookmarksResponse>(queryKey)
    const query = readQuery(queryKey)
    if (!current || !query) return
    const withoutOptimistic = current.items.filter(
      (item) => item.questionId !== patch.questionId
    )
    const nextTotal = Math.max(0, current.total - 1)
    const desiredVisibleCount =
      query.page === 1
        ? Math.min(query.pageSize, nextTotal)
        : current.items.length
    const rollbackCandidates = new Map(
      [...withoutOptimistic, ...displacedItems].map((item) => [
        item.questionId,
        item
      ])
    )
    const items = sortBookmarks(
      [...rollbackCandidates.values()],
      desiredVisibleCount
    )
    queryClient.setQueryData<ListBookmarksResponse>(queryKey, {
      ...current,
      items,
      total: nextTotal
    })
  })
}

export const rollbackOptimisticDeleteBookmark = (
  queryClient: QueryClient,
  snapshot: BookmarkCacheSnapshot,
  questionId: string
): void => {
  const wasKnownBookmarked = snapshot.entries.some(([, data]) =>
    data?.items.some((item) => item.questionId === questionId)
  )
  snapshotBookmarkCache(queryClient).entries.forEach(([queryKey, current]) => {
    const previous = readSnapshotData(snapshot, queryKey)
    const query = readQuery(queryKey)
    if (!current || !previous || !query) return
    const previousBookmark = previous.items.find(
      (item) => item.questionId === questionId
    )
    const wasCounted = query.questionIds
      ? wasKnownBookmarked && query.questionIds.includes(questionId)
      : wasKnownBookmarked && previous.total > 0
    const withoutCurrent = current.items.filter(
      (item) => item.questionId !== questionId
    )
    const items = previousBookmark
      ? sortBookmarks([...withoutCurrent, previousBookmark], query.pageSize)
      : current.items
    queryClient.setQueryData<ListBookmarksResponse>(queryKey, {
      ...current,
      items,
      total: wasCounted ? current.total + 1 : current.total
    })
  })
}

export const replaceOptimisticBookmark = (
  queryClient: QueryClient,
  bookmark: BookmarkSummary
): void => {
  snapshotBookmarkCache(queryClient).entries.forEach(([queryKey, data]) => {
    if (!data) return
    queryClient.setQueryData<ListBookmarksResponse>(queryKey, {
      ...data,
      items: data.items.map((item) =>
        item.questionId === bookmark.questionId ? bookmark : item
      )
    })
  })
}

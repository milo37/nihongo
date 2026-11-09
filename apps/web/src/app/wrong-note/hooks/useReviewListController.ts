import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useSearchParams } from 'react-router'
import type { ParsedListReviewListQuery } from '@nihongo/contracts/wrong-note/list-review-list'
import { useListReviewList } from '@app/wrong-note/hooks/useListReviewList'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'
import {
  createReviewListSearch,
  parseReviewListSearch
} from '@app/wrong-note/reviewListSearch'

export type ReviewListEmpty = 'never' | 'allDone' | 'noReviewed' | 'levelNone'

export const useReviewListController = (
  rowLinks: RefObject<Map<string, HTMLAnchorElement>>
) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const parsed = useMemo(
    () => parseReviewListSearch(searchParams),
    [searchParams]
  )
  const query = parsed.query
  const list = useListReviewList(query)
  // Tab counts ignore the level chip, so a filtered view also reads the totals.
  const overall = useQuery({
    ...wrongNoteQueries.reviewList({ pageSize: 1 }),
    enabled: query.level !== undefined
  })
  const counts =
    query.level === undefined ? list.data?.counts : overall.data?.counts
  const totalPages = Math.max(
    1,
    Math.ceil((list.data?.total ?? 0) / (list.data?.pageSize ?? 20))
  )
  const isSettled = list.isSuccess && !list.isPlaceholderData
  const correcting = isSettled && query.page > totalPages
  const returnedRowHandled = useRef<string | null>(null)

  useEffect(() => {
    if (parsed.needsReplace)
      setSearchParams(parsed.canonicalSearch, { replace: true })
  }, [parsed.needsReplace, parsed.canonicalSearch, setSearchParams])
  useEffect(() => {
    if (correcting)
      setSearchParams(createReviewListSearch({ ...query, page: totalPages }), {
        replace: true
      })
  }, [correcting, query, totalPages, setSearchParams])
  useEffect(() => {
    if (!isSettled || list.isFetching) return
    const focusId: unknown = location.state?.reviewFocus
    if (
      typeof focusId !== 'string' ||
      returnedRowHandled.current === location.key
    )
      return
    returnedRowHandled.current = location.key
    const target = rowLinks.current.get(focusId)
    target?.focus()
    target?.scrollIntoView?.({ block: 'nearest' })
  }, [isSettled, list.isFetching, location.key, location.state, rowLinks])

  const setQuery = (next: Partial<ParsedListReviewListQuery>): void => {
    setSearchParams(createReviewListSearch({ ...query, page: 1, ...next }))
  }

  let empty: ReviewListEmpty | null = null
  if (isSettled && list.data.total === 0 && counts) {
    const tabTotal =
      query.state === 'TO_REVIEW' ? counts.toReview : counts.reviewed
    if (counts.toReview === 0 && counts.reviewed === 0) empty = 'never'
    else if (tabTotal > 0) empty = 'levelNone'
    else empty = query.state === 'TO_REVIEW' ? 'allDone' : 'noReviewed'
  }
  const tabTotal =
    counts && (query.state === 'TO_REVIEW' ? counts.toReview : counts.reviewed)

  return {
    correcting,
    counts,
    empty,
    list,
    query,
    returnTo: `/wrong-notes${parsed.canonicalSearch ? `?${parsed.canonicalSearch}` : ''}`,
    setQuery,
    showLevels: Boolean(tabTotal),
    totalPages
  }
}

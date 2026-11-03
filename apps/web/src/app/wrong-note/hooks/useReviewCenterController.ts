import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import type { ParsedListReviewQueueQuery } from '@nihongo/contracts/wrong-note/list-review-queue'
import { useListReviewQueue } from '@app/wrong-note/hooks/useListReviewQueue'
import { useListWrongNotes } from '@app/wrong-note/hooks/useListWrongNotes'
import {
  createReviewQueueSearch,
  parseReviewQueueSearch
} from '@app/wrong-note/reviewQueueSearch'

const advancedKey = (query: ParsedListReviewQueueQuery): string =>
  JSON.stringify([query.questionType ?? '', query.tag ?? '', query.sort])

type UseReviewCenterControllerInput = {
  heading: RefObject<HTMLHeadingElement | null>
  resultHeading: RefObject<HTMLHeadingElement | null>
  rowLinks: RefObject<Map<string, HTMLAnchorElement>>
}

export const useReviewCenterController = ({
  heading,
  resultHeading,
  rowLinks
}: UseReviewCenterControllerInput) => {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const parsed = useMemo(
    () => parseReviewQueueSearch(searchParams),
    [searchParams]
  )
  const query = parsed.query
  const queue = useListReviewQueue(query, true)
  const isEmptyPlaceholder = queue.isPlaceholderData && queue.data?.total === 0
  const hasFilters = Boolean(
    query.level || query.subject || query.questionType || query.tag
  )
  const history = useListWrongNotes(
    { page: 1, pageSize: 20, sort: 'RECENT' },
    queue.isSuccess &&
      !queue.isPlaceholderData &&
      queue.data.total === 0 &&
      !hasFilters
  )
  const currentAdvancedKey = advancedKey(query)
  const [disclosure, setDisclosure] = useState<{
    key: string
    open: boolean
  } | null>(null)
  const hasAdvancedFilters = Boolean(
    query.questionType || query.tag || query.sort !== 'NEXT_REVIEW'
  )
  const expanded =
    disclosure?.key === currentAdvancedKey
      ? disclosure.open
      : hasAdvancedFilters
  const pendingFocus = useRef<string | null>(null)
  const returnedRowHandled = useRef<string | null>(null)
  const shouldFocusRetry = useRef(false)
  const totalPages = Math.max(
    1,
    Math.ceil((queue.data?.total ?? 0) / (queue.data?.pageSize ?? 20))
  )
  const correcting = Boolean(
    queue.data && !queue.isPlaceholderData && query.page > totalPages
  )

  useEffect(() => {
    if (parsed.needsReplace)
      setSearchParams(parsed.canonicalSearch, { replace: true })
  }, [parsed.needsReplace, parsed.canonicalSearch, setSearchParams])
  useEffect(() => {
    if (!correcting) return
    const next = createReviewQueueSearch({ ...query, page: totalPages })
    pendingFocus.current = next.toString()
    setSearchParams(next, { replace: true })
  }, [correcting, query, totalPages, setSearchParams])
  useEffect(() => {
    if (
      !queue.isSuccess ||
      queue.isFetching ||
      queue.isPlaceholderData ||
      correcting
    )
      return
    const focusId: unknown = location.state?.reviewFocus
    if (
      typeof focusId === 'string' &&
      returnedRowHandled.current !== location.key
    ) {
      returnedRowHandled.current = location.key
      const target = rowLinks.current.get(focusId) ?? resultHeading.current
      target?.focus()
      target?.scrollIntoView?.({ block: 'nearest' })
    } else if (shouldFocusRetry.current) {
      shouldFocusRetry.current = false
      heading.current?.focus()
    } else if (pendingFocus.current === parsed.canonicalSearch) {
      pendingFocus.current = null
      resultHeading.current?.focus()
    }
  }, [
    queue.isSuccess,
    queue.isFetching,
    queue.isPlaceholderData,
    queue.data,
    correcting,
    parsed.canonicalSearch,
    location.key,
    location.state,
    heading,
    resultHeading,
    rowLinks
  ])

  const setValue = (
    key: keyof ParsedListReviewQueueQuery,
    value: string | number | undefined,
    focus = false
  ): void => {
    const nextQuery = {
      ...query,
      [key]: value,
      ...(key === 'page' ? {} : { page: 1 })
    }
    if (['questionType', 'tag', 'sort'].includes(key))
      setDisclosure({ key: advancedKey(nextQuery), open: true })
    const next = createReviewQueueSearch(nextQuery)
    pendingFocus.current = focus ? next.toString() : null
    setSearchParams(next)
  }
  const reset = (): void => {
    pendingFocus.current = ''
    setSearchParams(new URLSearchParams())
  }
  const toggleAdvanced = (open: boolean): void => {
    if (open !== expanded) setDisclosure({ key: currentAdvancedKey, open })
  }
  const retry = (): void => {
    shouldFocusRetry.current = true
    void queue.refetch()
  }
  const returnTo = `/wrong-notes${parsed.canonicalSearch ? `?${parsed.canonicalSearch}` : ''}`
  const tags = queue.data?.availableTags ?? []
  const visibleTags =
    query.tag && !tags.includes(query.tag) ? [query.tag, ...tags] : tags
  const allEmpty =
    !hasFilters &&
    history.isSuccess &&
    !history.isPlaceholderData &&
    history.data.total === 0
  const emptyVariant = allEmpty
    ? 'empty'
    : hasFilters
      ? 'filtered'
      : query.view === 'DUE'
        ? 'dueEmpty'
        : 'rangeEmpty'

  return {
    allEmpty,
    correcting,
    emptyVariant,
    expanded,
    hasAdvancedFilters,
    hasFilters,
    isEmptyPlaceholder,
    query,
    queue,
    reset,
    retry,
    returnTo,
    setValue,
    toggleAdvanced,
    totalPages,
    visibleTags
  }
}

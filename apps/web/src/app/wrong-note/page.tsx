import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type {
  JlptLevel,
  QuestionSubject,
  WrongNoteStatus
} from '@common/types/domain'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { Pagination } from '@common/components/Pagination'
import { Select } from '@common/components/Select'
import { useListWrongNotes } from '@app/wrong-note/hooks/useListWrongNotes'
import {
  createWrongNoteHistorySearch,
  parseWrongNoteHistorySearch,
  type WrongNoteHistorySearchKey
} from '@app/wrong-note/wrongNoteHistorySearch'
import { resolveUiLocale } from '@/i18n/types'
import { formatDateTime, formatNumber } from '@libs/localeFormatters'
import { useTrackWrongNoteOpened } from '@/analytics/client'

const levelValues: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
const subjectValues: QuestionSubject[] = ['VOCABULARY', 'GRAMMAR', 'READING']
const statusValues: WrongNoteStatus[] = ['NEW', 'REVIEWING', 'AGAIN', 'SOLVED']
const statusVariants = {
  NEW: 'info',
  REVIEWING: 'warning',
  AGAIN: 'danger',
  SOLVED: 'success'
} as const

export const WrongNotePage = (): ReactElement => {
  useTrackWrongNoteOpened('LIST')
  const { i18n, t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const formatDate = (value: string): string =>
    formatDateTime(value, locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  const headingRef = useRef<HTMLHeadingElement>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)
  const shouldRestoreRetryFocusRef = useRef(false)
  const shouldFocusResultsRef = useRef(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const parsedSearch = useMemo(
    () => parseWrongNoteHistorySearch(searchParams),
    [searchParams]
  )
  const { level, page, sort, status, subject, tag } = parsedSearch.query
  const returnTo = `/wrong-notes/history${parsedSearch.canonicalSearch ? `?${parsedSearch.canonicalSearch}` : ''}`
  const wrongNotesQuery = useListWrongNotes(parsedSearch.query)
  const totalPages = wrongNotesQuery.data
    ? Math.max(
        1,
        Math.ceil(wrongNotesQuery.data.total / wrongNotesQuery.data.pageSize)
      )
    : 1
  const isOutOfRangePage = Boolean(
    wrongNotesQuery.data &&
      !wrongNotesQuery.isPlaceholderData &&
      page > totalPages
  )
  const availableTags = wrongNotesQuery.data?.availableTags ?? []
  const visibleTags =
    tag && !availableTags.includes(tag)
      ? [tag, ...availableTags]
      : availableTags
  const isWrongNotesPaused = wrongNotesQuery.fetchStatus === 'paused'

  useEffect(() => {
    if (!parsedSearch.needsReplace) return
    shouldFocusResultsRef.current = true
    setSearchParams(parsedSearch.canonicalSearch, { replace: true })
  }, [parsedSearch, setSearchParams])

  useEffect(() => {
    if (!isOutOfRangePage || page <= totalPages) {
      return
    }

    shouldFocusResultsRef.current = true
    const next = createWrongNoteHistorySearch({
      ...parsedSearch.query,
      page: totalPages
    })
    setSearchParams(next, { replace: true })
  }, [isOutOfRangePage, page, parsedSearch.query, setSearchParams, totalPages])

  const isPageCorrectionPending =
    isOutOfRangePage ||
    Boolean(
      wrongNotesQuery.isPlaceholderData &&
        wrongNotesQuery.data &&
        wrongNotesQuery.data.page !== page &&
        wrongNotesQuery.data.page > totalPages
    )

  useEffect(() => {
    if (
      wrongNotesQuery.isSuccess &&
      wrongNotesQuery.data &&
      shouldRestoreRetryFocusRef.current
    ) {
      shouldRestoreRetryFocusRef.current = false
      headingRef.current?.focus()
    }
  }, [wrongNotesQuery.data, wrongNotesQuery.isSuccess])

  useEffect(() => {
    if (
      !wrongNotesQuery.isSuccess ||
      wrongNotesQuery.isPlaceholderData ||
      wrongNotesQuery.fetchStatus !== 'idle' ||
      !shouldFocusResultsRef.current
    ) {
      return
    }
    shouldFocusResultsRef.current = false
    const focusTarget = resultHeadingRef.current ?? headingRef.current
    focusTarget?.focus()
  }, [
    wrongNotesQuery.data,
    wrongNotesQuery.fetchStatus,
    wrongNotesQuery.isPlaceholderData,
    wrongNotesQuery.isSuccess
  ])

  const setFilter = (key: WrongNoteHistorySearchKey, value: string): void => {
    const nextParams = createWrongNoteHistorySearch(parsedSearch.query)
    if (value) nextParams.set(key, value)
    else nextParams.delete(key)
    if (key !== 'page') nextParams.delete('page')
    shouldFocusResultsRef.current = true
    setSearchParams(parseWrongNoteHistorySearch(nextParams).canonicalSearch)
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-black tracking-[0.16em] text-brand">
            {t('history.eyebrow')}
          </p>
          <h1
            ref={headingRef}
            className="mt-2 rounded-sm text-4xl font-black"
            tabIndex={-1}
          >
            {t('history.title')}
          </h1>
          <p className="mt-4 leading-7 text-muted">
            {t('history.description')}
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 font-bold text-ink hover:border-slate-400"
          to="/wrong-notes"
        >
          {t('history.backToCenter')}
        </Link>
      </div>

      <div className="mt-8 grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          name="level"
          label={t('history.filters.level')}
          value={level ?? ''}
          onChange={(event) => setFilter('level', event.currentTarget.value)}
        >
          <option value="">{t('history.filters.allLevels')}</option>
          {levelValues.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Select
          name="subject"
          label={t('history.filters.subject')}
          value={subject ?? ''}
          onChange={(event) => setFilter('subject', event.currentTarget.value)}
        >
          <option value="">{t('history.filters.allSubjects')}</option>
          {subjectValues.map((value) => (
            <option key={value} value={value}>
              {commonT(`taxonomy.subjects.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          name="status"
          label={t('history.filters.status')}
          value={status ?? ''}
          onChange={(event) => setFilter('status', event.currentTarget.value)}
        >
          <option value="">{t('history.filters.allStatuses')}</option>
          {statusValues.map((value) => (
            <option key={value} value={value}>
              {commonT(`taxonomy.wrongNoteStatuses.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          name="tag"
          label={t('history.filters.tag')}
          value={tag ?? ''}
          onChange={(event) => setFilter('tag', event.currentTarget.value)}
        >
          <option value="">{t('history.filters.allTags')}</option>
          {visibleTags.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Select
          name="sort"
          label={t('history.filters.sort')}
          value={sort}
          onChange={(event) => setFilter('sort', event.currentTarget.value)}
        >
          <option value="RECENT">{t('history.filters.recent')}</option>
          <option value="MOST_WRONG">{t('history.filters.mostWrong')}</option>
          <option value="OLDEST">{t('history.filters.oldest')}</option>
        </Select>
      </div>

      {isWrongNotesPaused ? (
        <p
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950"
          role="status"
        >
          {t('history.states.offline')}
        </p>
      ) : null}

      {wrongNotesQuery.isPending && !isWrongNotesPaused ? (
        <LoadingState message={t('history.states.loading')} />
      ) : null}

      {wrongNotesQuery.isFetching && wrongNotesQuery.data ? (
        <p className="sr-only" role="status" aria-atomic="true">
          {t('history.states.refreshing')}
        </p>
      ) : null}

      {wrongNotesQuery.isError && !wrongNotesQuery.data ? (
        <ErrorState
          autoFocus
          title={t('history.states.errorTitle')}
          description={t('history.states.errorDescription')}
          action={
            <Button
              onClick={() => {
                shouldRestoreRetryFocusRef.current = true
                void wrongNotesQuery.refetch()
              }}
            >
              {commonT('actions.retry')}
            </Button>
          }
        />
      ) : null}

      {wrongNotesQuery.isError && wrongNotesQuery.data ? (
        <div
          className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p className="font-semibold">{t('history.states.stale')}</p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => {
              shouldRestoreRetryFocusRef.current = true
              void wrongNotesQuery.refetch()
            }}
          >
            {t('history.states.retryStale')}
          </Button>
        </div>
      ) : null}

      {isPageCorrectionPending ? (
        <LoadingState message={t('history.states.correctingPage')} />
      ) : null}

      {wrongNotesQuery.data &&
      wrongNotesQuery.data.items.length === 0 &&
      !isPageCorrectionPending ? (
        <EmptyState
          title={t('history.states.emptyTitle')}
          description={t('history.states.emptyDescription')}
          action={
            <Link
              className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-bold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              to="/practice"
            >
              {t('history.states.start')}
            </Link>
          }
        />
      ) : null}

      {wrongNotesQuery.data &&
      wrongNotesQuery.data.items.length > 0 &&
      !isPageCorrectionPending ? (
        <>
          <div className="mt-7 flex items-center justify-between gap-4">
            <h2
              ref={resultHeadingRef}
              className="rounded-sm text-xl font-black"
              tabIndex={-1}
            >
              {t('history.results.count', {
                formattedCount: formatCount(wrongNotesQuery.data.total)
              })}
            </h2>
            <Button
              variant="ghost"
              onClick={() => {
                shouldFocusResultsRef.current = true
                setSearchParams(new URLSearchParams())
              }}
            >
              {t('history.results.resetFilters')}
            </Button>
          </div>
          <ul
            className="mt-4 grid gap-4 lg:grid-cols-2"
            aria-busy={wrongNotesQuery.isFetching}
          >
            {wrongNotesQuery.data.items.map((item) => (
              <li key={item.questionId}>
                <article className="content-auto flex h-full min-w-0 flex-col rounded-xl border border-line bg-surface p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="brand">{item.level}</Badge>
                      <Badge>
                        {commonT(`taxonomy.subjects.${item.subject}`)}
                      </Badge>
                      <Badge variant={statusVariants[item.status]}>
                        {commonT(`taxonomy.wrongNoteStatuses.${item.status}`)}
                      </Badge>
                      <Badge
                        variant={
                          item.reviewAvailability === 'ARCHIVED'
                            ? 'neutral'
                            : 'info'
                        }
                      >
                        {commonT(
                          `taxonomy.availability.${item.reviewAvailability}`
                        )}
                      </Badge>
                    </div>
                    <span className="text-sm font-bold text-red-700">
                      {t('history.results.wrongCount', {
                        formattedCount: formatCount(item.wrongCount)
                      })}
                    </span>
                  </div>
                  <h3
                    className="mt-5 line-clamp-2 break-words text-lg font-black leading-7"
                    lang="ja"
                  >
                    {item.questionPreview}
                  </h3>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted">
                        {t('history.results.questionType')}
                      </dt>
                      <dd className="mt-1 font-semibold">
                        {commonT(`taxonomy.questionTypes.${item.questionType}`)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">
                        {t('history.results.lastWrong')}
                      </dt>
                      <dd className="mt-1 font-semibold">
                        {formatDate(item.lastWrongAt)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.tags.map((tagLabel) => (
                      <Badge key={tagLabel}>{tagLabel}</Badge>
                    ))}
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
                    <span className="inline-flex min-h-11 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-bold text-amber-950">
                      {item.reviewAvailability === 'ARCHIVED'
                        ? t('history.results.archived')
                        : t('history.results.available')}
                    </span>
                    <Link
                      className="inline-flex min-h-11 items-center rounded-lg bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
                      to={`/wrong-notes/${item.questionId}?returnTo=${encodeURIComponent(returnTo)}`}
                    >
                      {t('history.results.detail')}
                    </Link>
                  </div>
                </article>
              </li>
            ))}
          </ul>
          <Pagination
            className="mt-8"
            currentPage={wrongNotesQuery.data.page}
            totalPages={totalPages}
            disabled={wrongNotesQuery.isFetching}
            getPageHref={(nextPage) => {
              const next = createWrongNoteHistorySearch({
                ...parsedSearch.query,
                page: nextPage
              })
              return `?${next.toString()}`
            }}
            onPageChange={(nextPage) => setFilter('page', String(nextPage))}
          />
        </>
      ) : null}
    </section>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type { ParsedListReviewQueueQuery } from '@nihongo/contracts/wrong-note/list-review-queue'
import { LEVELS, QUESTION_TYPES, SUBJECTS } from '@common/types/domain'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { Pagination } from '@common/components/Pagination'
import { Select } from '@common/components/Select'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { useListReviewQueue } from '@app/wrong-note/hooks/useListReviewQueue'
import {
  createReviewQueueSearch,
  parseReviewQueueSearch
} from '@app/wrong-note/reviewQueueSearch'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'
import { resolveUiLocale } from '@/i18n/types'
import { formatDateTime, formatNumber } from '@libs/localeFormatters'
import {
  isNoEligibleQuestionsApiError,
  isOfflineApiError
} from '@libs/apiError'
import { useTrackWrongNoteOpened } from '@/analytics/client'

const viewOptions = [
  { value: 'DUE', countKey: 'due' },
  { value: 'UNREVIEWED', countKey: 'unreviewed' },
  { value: 'REPEATED', countKey: 'repeated' },
  { value: 'SOLVED', countKey: 'solved' }
] as const
const batchCounts = [5, 10, 20] as const
const statusVariants = {
  NEW: 'info',
  AGAIN: 'danger',
  REVIEWING: 'warning',
  SOLVED: 'success'
} as const
export const WrongNoteReviewCenterPage = (): ReactElement => {
  useTrackWrongNoteOpened('REVIEW_CENTER')
  const { i18n, t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const formatObservedAt = (value: string): string =>
    formatDateTime(value, locale, {
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const parsedSearch = useMemo(
    () => parseReviewQueueSearch(searchParams),
    [searchParams]
  )
  const queueQuery = useListReviewQueue(parsedSearch.query)
  const createSession = useCreateStudySession()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const [batchCount, setBatchCount] = useState<(typeof batchCounts)[number]>(10)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const resultHeadingRef = useRef<HTMLHeadingElement>(null)
  const pendingResultsFocusSearchRef = useRef<string | null>(null)
  const shouldFocusRetryRef = useRef(false)
  const batchRequestContext = `${parsedSearch.canonicalSearch}|${batchCount}`
  const previousBatchRequestContextRef = useRef(batchRequestContext)

  useEffect(() => {
    if (!parsedSearch.needsReplace) return
    pendingResultsFocusSearchRef.current = parsedSearch.canonicalSearch
    setSearchParams(parsedSearch.canonicalSearch, { replace: true })
  }, [parsedSearch.canonicalSearch, parsedSearch.needsReplace, setSearchParams])

  useEffect(() => {
    if (
      !queueQuery.isSuccess ||
      !queueQuery.data ||
      queueQuery.fetchStatus !== 'idle'
    ) {
      return
    }
    if (shouldFocusRetryRef.current) {
      shouldFocusRetryRef.current = false
      pendingResultsFocusSearchRef.current = null
      headingRef.current?.focus()
    } else if (
      pendingResultsFocusSearchRef.current === parsedSearch.canonicalSearch
    ) {
      pendingResultsFocusSearchRef.current = null
      resultHeadingRef.current?.focus()
    }
  }, [
    parsedSearch.canonicalSearch,
    queueQuery.data,
    queueQuery.fetchStatus,
    queueQuery.isSuccess
  ])

  useEffect(() => {
    if (!queueQuery.data || queueQuery.isPlaceholderData) return
    const totalPages = Math.max(
      1,
      Math.ceil(queueQuery.data.total / queueQuery.data.pageSize)
    )
    if (parsedSearch.query.page <= totalPages) return
    const next = createReviewQueueSearch({
      ...parsedSearch.query,
      page: totalPages
    })
    pendingResultsFocusSearchRef.current = next.toString()
    setSearchParams(next, { replace: true })
  }, [
    parsedSearch.query,
    queueQuery.data,
    queueQuery.isPlaceholderData,
    setSearchParams
  ])

  useEffect(() => {
    if (previousBatchRequestContextRef.current === batchRequestContext) return
    if (createSession.isPending) return
    previousBatchRequestContextRef.current = batchRequestContext
    createSession.reset()
  }, [batchRequestContext, createSession])

  const setQueryValue = (
    key: keyof ParsedListReviewQueueQuery,
    value: string | number | undefined,
    focusResults = true
  ): void => {
    const next = {
      ...parsedSearch.query,
      [key]: value,
      ...(key === 'page' ? {} : { page: 1 })
    }
    const nextSearch = createReviewQueueSearch(next)
    pendingResultsFocusSearchRef.current = focusResults
      ? nextSearch.toString()
      : null
    setSearchParams(nextSearch)
  }

  const totalPages = queueQuery.data
    ? Math.max(1, Math.ceil(queueQuery.data.total / queueQuery.data.pageSize))
    : 1
  const isOutOfRangePage = Boolean(
    queueQuery.data &&
      !queueQuery.isPlaceholderData &&
      parsedSearch.query.page > totalPages
  )
  const isPageCorrectionPending =
    isOutOfRangePage ||
    Boolean(
      queueQuery.isPlaceholderData &&
        queueQuery.data &&
        queueQuery.data.page !== parsedSearch.query.page &&
        queueQuery.data.page > totalPages
    )
  const canOfferBatch =
    !isPageCorrectionPending &&
    !queueQuery.isPlaceholderData &&
    (queueQuery.data?.total ?? 0) > 0 &&
    parsedSearch.query.view === 'DUE' &&
    parsedSearch.query.level !== undefined &&
    parsedSearch.query.subject !== undefined
  const canStartBatch =
    canOfferBatch &&
    !queueQuery.isError &&
    !queueQuery.isFetching &&
    queueQuery.fetchStatus !== 'paused'

  const handleBatchStart = (): void => {
    const { level, questionType, subject, tag } = parsedSearch.query
    if (!canStartBatch || !level || !subject || createSession.isPending) return

    const reviewFilter = {
      ...(questionType ? { questionType } : {}),
      ...(tag ? { tag } : {})
    }
    createSession.mutate(
      {
        level,
        subject,
        mode: 'DAILY_REVIEW',
        count: batchCount,
        ...(Object.keys(reviewFilter).length > 0 ? { reviewFilter } : {})
      },
      {
        onSuccess: ({ session }, input) => {
          assertCurrentCreateStudySessionAction(input)
          beginPractice(session.id, session.startedAt)
          void navigate(`/practice/session/${session.id}`)
        },
        onError: (error) => {
          if (isAuthTransitionSupersededError(error)) return
        }
      }
    )
  }

  const counts = queueQuery.data?.counts
  const availableTags = queueQuery.data?.availableTags ?? []
  const visibleTags =
    parsedSearch.query.tag && !availableTags.includes(parsedSearch.query.tag)
      ? [parsedSearch.query.tag, ...availableTags]
      : availableTags
  const isQueuePaused = queueQuery.fetchStatus === 'paused'
  const returnTo = `/wrong-notes${parsedSearch.canonicalSearch ? `?${parsedSearch.canonicalSearch}` : ''}`

  return (
    <section className="learning-note study-page study-review study-review-center mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:py-8">
      <div className="flex flex-col gap-2 border-b border-line pb-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <h1
            ref={headingRef}
            className="study-page-title mt-2 rounded-sm text-2xl font-semibold sm:text-3xl"
            tabIndex={-1}
          >
            {t('center.title')}
          </h1>
          <p className="mt-3 leading-7 text-muted">{t('center.description')}</p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 font-bold text-ink hover:border-slate-400"
          to="/wrong-notes/history"
        >
          {t('center.history')}
        </Link>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {viewOptions.map((option) => (
          <button
            key={option.value}
            className={[
              'min-h-20 rounded-xl border p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              parsedSearch.query.view === option.value
                ? 'border-brand bg-brand-soft'
                : 'border-line bg-white hover:border-slate-400'
            ].join(' ')}
            type="button"
            aria-pressed={parsedSearch.query.view === option.value}
            onClick={() => setQueryValue('view', option.value)}
          >
            <span className="block text-sm font-bold text-muted">
              {t(`center.views.${option.value}`)}
            </span>
            <strong className="mt-1 block text-2xl text-ink">
              {counts ? formatCount(counts[option.countKey]) : '—'}
            </strong>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2 xl:grid-cols-5">
        <Select
          name="review-level"
          label={t('center.filters.level')}
          value={parsedSearch.query.level ?? ''}
          onChange={(event) =>
            setQueryValue(
              'level',
              event.currentTarget.value || undefined,
              false
            )
          }
        >
          <option value="">{t('center.filters.allLevels')}</option>
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </Select>
        <Select
          name="review-subject"
          label={t('center.filters.subject')}
          value={parsedSearch.query.subject ?? ''}
          onChange={(event) =>
            setQueryValue(
              'subject',
              event.currentTarget.value || undefined,
              false
            )
          }
        >
          <option value="">{t('center.filters.allSubjects')}</option>
          {SUBJECTS.map((subject) => (
            <option key={subject} value={subject}>
              {commonT(`taxonomy.subjects.${subject}`)}
            </option>
          ))}
        </Select>
        <Select
          name="review-question-type"
          label={t('center.filters.questionType')}
          value={parsedSearch.query.questionType ?? ''}
          onChange={(event) =>
            setQueryValue(
              'questionType',
              event.currentTarget.value || undefined,
              false
            )
          }
        >
          <option value="">{t('center.filters.allQuestionTypes')}</option>
          {QUESTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {commonT(`taxonomy.questionTypes.${type}`)}
            </option>
          ))}
        </Select>
        <Select
          name="review-tag"
          label={t('center.filters.tag')}
          value={parsedSearch.query.tag ?? ''}
          onChange={(event) =>
            setQueryValue('tag', event.currentTarget.value || undefined, false)
          }
        >
          <option value="">{t('center.filters.allTags')}</option>
          {visibleTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </Select>
        <Select
          name="review-sort"
          label={t('center.filters.sort')}
          value={parsedSearch.query.sort}
          onChange={(event) =>
            setQueryValue('sort', event.currentTarget.value, false)
          }
        >
          <option value="NEXT_REVIEW">{t('center.filters.nextReview')}</option>
          <option value="MOST_WRONG">{t('center.filters.mostWrong')}</option>
          <option value="RECENT">{t('center.filters.recent')}</option>
        </Select>
      </div>

      {canOfferBatch ? (
        <div className="study-review-batch mt-5 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-end sm:justify-between">
          <Select
            className="sm:w-44"
            name="review-batch-count"
            label={t('center.batch.count')}
            value={String(batchCount)}
            onChange={(event) =>
              setBatchCount(Number(event.currentTarget.value) as 5 | 10 | 20)
            }
          >
            {batchCounts.map((count) => (
              <option key={count} value={count}>
                {t('center.batch.countOption', {
                  formattedCount: formatCount(count)
                })}
              </option>
            ))}
          </Select>
          <Button
            isLoading={createSession.isPending}
            loadingLabel={t('center.batch.loading')}
            disabled={!canStartBatch}
            onClick={handleBatchStart}
          >
            {t('center.batch.start')}
          </Button>
        </div>
      ) : null}

      {createSession.isError ? (
        <p
          className="mt-4 rounded-lg border border-danger-line bg-danger-soft p-4 text-sm font-semibold text-danger-strong"
          role="alert"
        >
          {isOfflineApiError(createSession.error)
            ? t('center.batch.offline')
            : isNoEligibleQuestionsApiError(createSession.error)
              ? t('center.batch.noEligible')
              : t('center.batch.error')}
        </p>
      ) : null}

      {isQueuePaused ? (
        <p
          className="mt-6 rounded-lg border border-warning-line bg-warning-soft p-4 text-sm font-semibold text-warning-strong"
          role="status"
        >
          {t('center.states.offline')}
        </p>
      ) : null}
      {queueQuery.isPending && !isQueuePaused && !isPageCorrectionPending ? (
        <LoadingState message={t('center.states.loading')} />
      ) : null}
      {queueQuery.isFetching && queueQuery.data ? (
        <p className="sr-only" role="status" aria-atomic="true">
          {t('center.states.refreshing')}
        </p>
      ) : null}
      {queueQuery.isError && !queueQuery.data ? (
        <ErrorState
          autoFocus
          title={t('center.states.errorTitle')}
          description={t('center.states.errorDescription')}
          action={
            <Button
              onClick={() => {
                shouldFocusRetryRef.current = true
                void queueQuery.refetch()
              }}
            >
              {commonT('actions.retry')}
            </Button>
          }
        />
      ) : null}

      {queueQuery.isError && queueQuery.data ? (
        <div
          className="mt-6 rounded-lg border border-danger-line bg-danger-soft p-4 text-sm text-danger-strong"
          role="alert"
        >
          <p className="font-semibold">{t('center.states.stale')}</p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => {
              shouldFocusRetryRef.current = true
              void queueQuery.refetch()
            }}
          >
            {t('center.states.retryStale')}
          </Button>
        </div>
      ) : null}

      {isPageCorrectionPending ? (
        <LoadingState message={t('center.states.correctingPage')} />
      ) : null}

      {queueQuery.data && !isPageCorrectionPending ? (
        <>
          <div className="mt-7 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2
                ref={resultHeadingRef}
                className="rounded-sm text-xl font-black"
                tabIndex={-1}
              >
                {t('center.results.count', {
                  formattedCount: formatCount(queueQuery.data.total)
                })}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {t('center.results.observedAt', {
                  date: formatObservedAt(queueQuery.data.observedAt)
                })}
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                const nextSearch = new URLSearchParams()
                pendingResultsFocusSearchRef.current = nextSearch.toString()
                setSearchParams(nextSearch)
              }}
            >
              {t('center.results.resetFilters')}
            </Button>
          </div>

          {queueQuery.data.items.length === 0 ? (
            <EmptyState
              title={
                parsedSearch.query.view === 'DUE'
                  ? t('center.results.dueEmptyTitle')
                  : t('center.results.filteredEmptyTitle')
              }
              description={
                parsedSearch.query.view === 'DUE'
                  ? t('center.results.dueEmptyDescription')
                  : t('center.results.filteredEmptyDescription')
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Link
                    className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 font-bold text-white"
                    to="/wrong-notes/history"
                  >
                    {t('center.results.history')}
                  </Link>
                  <Link
                    className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-4 font-bold"
                    to="/practice"
                  >
                    {t('center.results.setup')}
                  </Link>
                </div>
              }
            />
          ) : (
            <ul
              className="study-review-list mt-4 grid gap-4 lg:grid-cols-2"
              aria-busy={queueQuery.isFetching}
            >
              {queueQuery.data.items.map((item) => (
                <li
                  key={item.questionId}
                  className="study-review-row content-auto min-w-0 border-b border-line py-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="brand">{item.level}</Badge>
                    <Badge>
                      {commonT(`taxonomy.subjects.${item.subject}`)}
                    </Badge>
                    <Badge variant={statusVariants[item.status]}>
                      {commonT(`taxonomy.wrongNoteStatuses.${item.status}`)}
                    </Badge>
                    {item.hasMemo ? (
                      <Badge variant="info">
                        {t('center.results.hasMemo')}
                      </Badge>
                    ) : null}
                  </div>
                  <h3
                    className="mt-4 break-words text-lg font-semibold leading-7"
                    lang="ja"
                  >
                    {item.questionPreview}
                  </h3>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted">
                        {t('center.results.wrong')}
                      </dt>
                      <dd className="font-bold">
                        {t('center.results.wrongCount', {
                          formattedCount: formatCount(item.wrongCount)
                        })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">
                        {t('center.results.streak')}
                      </dt>
                      <dd className="font-bold">
                        {t('center.results.wrongCount', {
                          formattedCount: formatCount(item.correctStreak)
                        })}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-muted">
                        {t('center.results.nextReview')}
                      </dt>
                      <dd className="font-bold">
                        {formatObservedAt(item.nextReviewAt)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.tags.map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </div>
                  <Link
                    className="mt-5 inline-flex min-h-11 items-center rounded-lg px-1 font-bold text-brand underline underline-offset-2 hover:no-underline"
                    to={`/wrong-notes/${item.questionId}?returnTo=${encodeURIComponent(returnTo)}`}
                  >
                    {t('center.results.detail')}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <Pagination
            className="mt-8"
            currentPage={queueQuery.data.page}
            totalPages={totalPages}
            disabled={queueQuery.isFetching}
            getPageHref={(nextPage) => {
              const next = createReviewQueueSearch({
                ...parsedSearch.query,
                page: nextPage
              })
              return `?${next.toString()}`
            }}
            label={t('center.results.pagination')}
            onPageChange={(page) => setQueryValue('page', page)}
          />
        </>
      ) : null}
    </section>
  )
}

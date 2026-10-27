import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type { ParsedListReviewQueueQuery } from '@nihongo/contracts/wrong-note/list-review-queue'
import {
  LEVELS,
  QUESTION_TYPES,
  SUBJECTS
} from '@nihongo/browser/common/types/domain'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Pagination } from '@nihongo/browser/common/components/Pagination'
import { Select } from '@nihongo/browser/common/components/Select'
import { useGetDashboardStats } from '@app/dashboard/hooks/useGetDashboardStats'
import { useGetStudySession } from '@app/practice/hooks/useGetStudySession'
import { useGetStudyResult } from '@app/practice/hooks/useGetStudyResult'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { readCurrentResult } from '@app/wrong-note/reviewReturnContext'
import { ReviewStatus } from '@app/wrong-note/components/ReviewStatus'
import { useListReviewQueue } from '@app/wrong-note/hooks/useListReviewQueue'
import { useListWrongNotes } from '@app/wrong-note/hooks/useListWrongNotes'
import {
  createReviewQueueSearch,
  parseReviewQueueSearch
} from '@app/wrong-note/reviewQueueSearch'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { useAppStore } from '@nihongo/browser/store/index'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import {
  formatDateTime,
  formatNumber
} from '@nihongo/browser/libs/localeFormatters'
import { useTrackWrongNoteOpened } from '@/analytics/client'

const views = ['DUE', 'UNREVIEWED', 'REPEATED', 'SOLVED'] as const
const advancedKey = (query: ParsedListReviewQueueQuery): string =>
  JSON.stringify([query.questionType ?? '', query.tag ?? '', query.sort])

const GuestReview = (): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const { user } = useAuth()
  const activeSessionId = useAppStore((state) => state.sessionId)
  const sessionId =
    readCurrentResult(getStudyDraftPrincipalScope(user)) ||
    activeSessionId ||
    ''
  const session = useGetStudySession(sessionId, true)
  const result = useGetStudyResult(sessionId, true)
  const hasVerifiedResult =
    session.isFetchedAfterMount &&
    result.isFetchedAfterMount &&
    !session.isFetching &&
    !result.isFetching &&
    !session.isError &&
    !result.isError &&
    session.fetchStatus !== 'paused' &&
    result.fetchStatus !== 'paused' &&
    session.data?.session.status === 'SUBMITTED' &&
    result.data?.sessionId === sessionId
  return (
    <section className="review-hub">
      <h1 className="review-title">{t('integration.title')}</h1>
      <EmptyState
        title={t('integration.guest.title')}
        description={t('integration.guest.description')}
        action={
          <div className="review-empty-actions">
            <Link
              className={getButtonClassName()}
              to="/login?redirect=%2Fwrong-notes"
            >
              {t('integration.guest.login')}
            </Link>
            <Link className="note-link" to="/practice">
              {t('integration.guest.practice')}
            </Link>
          </div>
        }
      />
      {hasVerifiedResult ? (
        <Link
          className="review-guest-result note-link"
          to={`/practice/result/${sessionId}`}
        >
          {t('integration.guest.result')}
        </Link>
      ) : null}
    </section>
  )
}

const MemberReview = (): ReactElement => {
  useTrackWrongNoteOpened('REVIEW_CENTER')
  const { i18n, t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const count = (value: number): string => formatNumber(value, locale)
  const date = (value: string): string =>
    formatDateTime(value, locale, { dateStyle: 'medium' })
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
  const [recentOpen, setRecentOpen] = useState(false)
  const recent = useGetDashboardStats(recentOpen)
  const currentAdvancedKey = advancedKey(query)
  const [disclosure, setDisclosure] = useState<{
    key: string
    open: boolean
  } | null>(null)
  const expanded =
    disclosure?.key === currentAdvancedKey
      ? disclosure.open
      : Boolean(query.questionType || query.tag || query.sort !== 'NEXT_REVIEW')
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const returnedRowHandled = useRef<string | null>(null)
  const shouldFocusRetry = useRef(false)
  const rowLinks = useRef(new Map<string, HTMLAnchorElement>())
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
    location.state
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
  const retry = (): void => {
    shouldFocusRetry.current = true
    void queue.refetch()
  }

  return (
    <section className="review-hub">
      <h1 ref={heading} className="review-title" tabIndex={-1}>
        {t('integration.title')}
      </h1>
      <form
        className="review-filters"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="review-basic-filters">
          <Select
            name="review-view"
            label={t('integration.range')}
            value={query.view}
            onChange={(event) => setValue('view', event.currentTarget.value)}
            options={views.map((view) => ({
              value: view,
              label: t(`integration.views.${view}`)
            }))}
          />
          <Select
            name="review-level"
            label={t('center.filters.level')}
            value={query.level ?? ''}
            onChange={(event) =>
              setValue('level', event.currentTarget.value || undefined)
            }
            options={[
              { value: '', label: t('center.filters.allLevels') },
              ...LEVELS.map((level) => ({ value: level, label: level }))
            ]}
          />
          <Select
            name="review-subject"
            label={t('center.filters.subject')}
            value={query.subject ?? ''}
            onChange={(event) =>
              setValue('subject', event.currentTarget.value || undefined)
            }
            options={[
              { value: '', label: t('center.filters.allSubjects') },
              ...SUBJECTS.map((subject) => ({
                value: subject,
                label: commonT(`taxonomy.subjects.${subject}`)
              }))
            ]}
          />
        </div>
        <details
          className="review-advanced"
          open={expanded}
          onToggle={(event) => {
            const open = event.currentTarget.open
            if (open !== expanded)
              setDisclosure({ key: currentAdvancedKey, open })
          }}
        >
          <summary>
            {t('integration.advanced')}
            {query.questionType || query.tag || query.sort !== 'NEXT_REVIEW' ? (
              <span className="review-applied">{t('integration.applied')}</span>
            ) : null}
          </summary>
          <div className="review-advanced-fields">
            <Select
              name="review-question-type"
              label={t('center.filters.questionType')}
              value={query.questionType ?? ''}
              onChange={(event) =>
                setValue('questionType', event.currentTarget.value || undefined)
              }
              options={[
                { value: '', label: t('center.filters.allQuestionTypes') },
                ...QUESTION_TYPES.map((type) => ({
                  value: type,
                  label: commonT(`taxonomy.questionTypes.${type}`)
                }))
              ]}
            />
            <Select
              name="review-tag"
              label={t('center.filters.tag')}
              value={query.tag ?? ''}
              onChange={(event) =>
                setValue('tag', event.currentTarget.value || undefined)
              }
              options={[
                { value: '', label: t('center.filters.allTags') },
                ...visibleTags.map((tag) => ({ value: tag, label: tag }))
              ]}
            />
            <Select
              name="review-sort"
              label={t('center.filters.sort')}
              value={query.sort}
              onChange={(event) => setValue('sort', event.currentTarget.value)}
              options={(['NEXT_REVIEW', 'MOST_WRONG', 'RECENT'] as const).map(
                (sort) => ({
                  value: sort,
                  label: t(`integration.sort.${sort}`)
                })
              )}
            />
          </div>
          <Button variant="ghost" onClick={reset}>
            {t('integration.reset')}
          </Button>
        </details>
      </form>
      {queue.fetchStatus === 'paused' ? (
        <p className="review-notice" role="status">
          {t('center.states.offline')}
        </p>
      ) : null}
      {((queue.isPending || isEmptyPlaceholder) &&
        queue.fetchStatus !== 'paused') ||
      correcting ? (
        <LoadingState
          message={t(
            correcting
              ? 'center.states.correctingPage'
              : 'center.states.loading'
          )}
        />
      ) : null}
      {queue.isError ? (
        <ErrorState
          title={t(
            queue.data ? 'center.states.stale' : 'center.states.errorTitle'
          )}
          description={t('center.states.errorDescription')}
          action={<Button onClick={retry}>{commonT('actions.retry')}</Button>}
        />
      ) : null}
      {queue.data && !isEmptyPlaceholder && !correcting ? (
        <>
          <div className="review-results-heading">
            <h2 ref={resultHeading} tabIndex={-1}>
              {t('integration.count', {
                formattedCount: count(queue.data.total)
              })}
            </h2>
            <p>{t(`integration.sort.${query.sort}`)}</p>
          </div>
          {queue.data.items.length ? (
            <ol className="review-items" aria-busy={queue.isFetching}>
              {queue.data.items.map((item) => (
                <li key={item.questionId} className="review-item">
                  <div className="review-item-meta">
                    <span>
                      {item.level} ·{' '}
                      {commonT(`taxonomy.subjects.${item.subject}`)}
                      <span className="review-row-tags">
                        {item.tags.length ? ` · ${item.tags.join(' · ')}` : ''}
                      </span>
                    </span>
                    <ReviewStatus status={item.status} />
                  </div>
                  <Link
                    ref={(node) => {
                      if (node) rowLinks.current.set(item.questionId, node)
                      else rowLinks.current.delete(item.questionId)
                    }}
                    className="review-item-link"
                    to={`/wrong-notes/${item.questionId}?returnTo=${encodeURIComponent(returnTo)}`}
                  >
                    <span className="review-preview" lang="ja">
                      {item.questionPreview}
                    </span>
                    <span className="review-row-action">
                      {t('integration.detail')}
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title={t(`integration.${emptyVariant}.title`)}
              description={t(`integration.${emptyVariant}.description`)}
              action={
                <div className="review-empty-actions">
                  {hasFilters ? (
                    <Button onClick={reset}>{t('integration.reset')}</Button>
                  ) : !allEmpty ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        setValue(
                          'view',
                          query.view === 'DUE' ? 'UNREVIEWED' : 'DUE',
                          true
                        )
                      }
                    >
                      {t(
                        query.view === 'DUE'
                          ? 'integration.views.UNREVIEWED'
                          : 'integration.views.DUE'
                      )}
                    </Button>
                  ) : null}
                  <Link className={getButtonClassName()} to="/practice">
                    {t('integration.start')}
                  </Link>
                </div>
              }
            />
          )}
          {queue.data.total > 0 ? (
            <Pagination
              currentPage={queue.data.page}
              totalPages={totalPages}
              requestedPage={query.page}
              disabled={
                queue.isFetching ||
                queue.isError ||
                queue.isPlaceholderData ||
                queue.fetchStatus === 'paused'
              }
              className="review-pagination"
              onPageChange={(page) => setValue('page', page)}
              getPageHref={(page) =>
                `?${createReviewQueueSearch({ ...query, page }).toString()}`
              }
              label={t('center.results.pagination')}
            />
          ) : null}
        </>
      ) : null}
      <details
        className="review-recent-results"
        open={recentOpen}
        onToggle={(event) => setRecentOpen(event.currentTarget.open)}
      >
        <summary>{t('integration.recent.title')}</summary>
        {recentOpen ? (
          recent.isPending ? (
            <LoadingState message={t('integration.recent.loading')} />
          ) : recent.isError ? (
            <ErrorState
              title={t('integration.recent.error')}
              description={t('center.states.errorDescription')}
              action={
                <Button
                  onClick={() => {
                    void recent.refetch()
                  }}
                >
                  {commonT('actions.retry')}
                </Button>
              }
            />
          ) : recent.data ? (
            <>
              {recent.data.recentStudySessions.slice(0, 5).map((session) => (
                <div className="review-recent-row" key={session.id}>
                  <div>
                    <strong>
                      {session.level} ·{' '}
                      {commonT(`taxonomy.subjects.${session.subject}`)} ·{' '}
                      {t('integration.count', {
                        formattedCount: count(session.totalCount)
                      })}
                    </strong>
                    <p>{date(session.submittedAt)}</p>
                  </div>
                  <Link
                    className="note-link"
                    to={`/practice/result/${session.id}`}
                  >
                    {t('integration.recent.result')}
                  </Link>
                </div>
              ))}
              <p className="review-recent-note">
                {t(
                  recent.data.recentStudySessions.length
                    ? 'integration.recent.limit'
                    : 'integration.recent.empty'
                )}
              </p>
            </>
          ) : null
        ) : null}
      </details>
    </section>
  )
}

export const WrongNoteReviewCenterPage = (): ReactElement => {
  const { isReady, role, user } = useAuth()
  const { t } = useTranslation('wrongNote')
  if (!isReady) return <LoadingState message={t('center.states.loading')} />
  return role === 'GUEST' ? <GuestReview /> : <MemberReview key={user?.id} />
}

import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { ReviewEventHistoryItem } from '@nihongo/contracts/wrong-note/list-review-events'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import type { useListReviewEvents } from '@app/wrong-note/hooks/useListReviewEvents'
import { resolveUiLocale } from '@/i18n/types'
import { formatDateTime, formatNumber } from '@libs/localeFormatters'

type ReviewTimelineProps = {
  historyQuery: ReturnType<typeof useListReviewEvents>
}

export const ReviewTimeline = ({
  historyQuery
}: ReviewTimelineProps): ReactElement => {
  const { i18n, t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const outcomeLabel = (event: ReviewEventHistoryItem): string => {
    if (event.isCorrect === null) return t('timeline.outcomes.none')
    return event.isCorrect
      ? t('timeline.outcomes.correct')
      : t('timeline.outcomes.incorrect')
  }
  const loadMoreButtonRef = useRef<HTMLButtonElement>(null)
  const emptyStateRef = useRef<HTMLParagraphElement>(null)
  const previousItemCountRef = useRef(0)
  const focusNewItemsRef = useRef(false)
  const focusRetryRef = useRef(false)
  const focusInitialRetryRef = useRef(false)
  const items = useMemo(
    () => historyQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [historyQuery.data]
  )
  const isHistoryPaused = historyQuery.fetchStatus === 'paused'
  const hasBackgroundRefreshError =
    historyQuery.isRefetchError && !historyQuery.isFetchNextPageError

  useEffect(() => {
    if (historyQuery.isFetchNextPageError && focusRetryRef.current) {
      focusRetryRef.current = false
      loadMoreButtonRef.current?.focus()
    }
  }, [historyQuery.isFetchNextPageError])

  useEffect(() => {
    if (
      !focusNewItemsRef.current ||
      items.length <= previousItemCountRef.current
    ) {
      previousItemCountRef.current = items.length
      return
    }
    const newlyLoaded = items[previousItemCountRef.current]
    previousItemCountRef.current = items.length
    focusNewItemsRef.current = false
    if (newlyLoaded) {
      document.getElementById(`review-event-${newlyLoaded.id}`)?.focus()
    }
  }, [items])

  useEffect(() => {
    if (!historyQuery.isSuccess || !focusInitialRetryRef.current) return
    focusInitialRetryRef.current = false
    const first = items[0]
    if (first) {
      document.getElementById(`review-event-${first.id}`)?.focus()
    } else {
      emptyStateRef.current?.focus()
    }
  }, [historyQuery.isSuccess, items])

  if (historyQuery.isPending) {
    if (isHistoryPaused) {
      return (
        <p className="text-sm font-semibold text-amber-900" role="status">
          {t('timeline.loadingOffline')}
        </p>
      )
    }
    return (
      <p className="text-sm font-semibold text-muted" role="status">
        {t('timeline.loading')}
      </p>
    )
  }

  if (historyQuery.isError && !historyQuery.data) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        role="alert"
      >
        <p>{t('timeline.loadError')}</p>
        <Button
          className="mt-3"
          size="sm"
          onClick={() => {
            focusInitialRetryRef.current = true
            void historyQuery.refetch()
          }}
        >
          {commonT('actions.retry')}
        </Button>
      </div>
    )
  }

  const backgroundRefreshError = hasBackgroundRefreshError ? (
    <div
      className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
      role="alert"
    >
      <p>{t('timeline.stale')}</p>
      <Button
        className="mt-3"
        size="sm"
        onClick={() => {
          focusInitialRetryRef.current = true
          void historyQuery.refetch()
        }}
      >
        {t('timeline.retryStale')}
      </Button>
    </div>
  ) : null

  if (items.length === 0) {
    return (
      <div>
        {isHistoryPaused ? (
          <p
            className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950"
            role="status"
          >
            {t('timeline.emptyOffline')}
          </p>
        ) : null}
        {backgroundRefreshError}
        <p
          ref={emptyStateRef}
          className="rounded-lg bg-slate-50 p-4 text-sm text-muted"
          tabIndex={-1}
        >
          {t('timeline.empty')}
        </p>
      </div>
    )
  }

  return (
    <div>
      {isHistoryPaused ? (
        <p
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950"
          role="status"
        >
          {t('timeline.cachedOffline')}
        </p>
      ) : null}
      {backgroundRefreshError}
      <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
        {items.map((event) => (
          <li
            key={event.id}
            id={`review-event-${event.id}`}
            className="content-auto rounded-xl border border-line bg-surface p-4 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-brand"
            tabIndex={-1}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  event.isCorrect === true
                    ? 'success'
                    : event.isCorrect === false
                      ? 'danger'
                      : 'neutral'
                }
              >
                {outcomeLabel(event)}
              </Badge>
              <strong className="text-sm">
                {t(`timeline.sources.${event.source}`)}
              </strong>
              <time className="text-xs text-muted" dateTime={event.occurredAt}>
                {formatDateTime(event.occurredAt, locale, {
                  dateStyle: 'medium',
                  timeStyle: 'long'
                })}
              </time>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">{t('timeline.statusChange')}</dt>
                <dd className="font-semibold">
                  {event.previousStatus
                    ? commonT(
                        `taxonomy.wrongNoteStatuses.${event.previousStatus}`
                      )
                    : t('timeline.recordStart')}{' '}
                  → {commonT(`taxonomy.wrongNoteStatuses.${event.nextStatus}`)}
                </dd>
              </div>
              <div>
                <dt className="text-muted">{t('timeline.wrongCount')}</dt>
                <dd className="font-semibold">
                  {formatCount(event.previousWrongCount ?? 0)} →{' '}
                  {formatCount(event.wrongCountAfter)}
                </dd>
              </div>
              <div>
                <dt className="text-muted">{t('timeline.streak')}</dt>
                <dd className="font-semibold">
                  {formatCount(event.previousCorrectStreak ?? 0)} →{' '}
                  {formatCount(event.nextCorrectStreak)}
                </dd>
              </div>
              <div>
                <dt className="text-muted">{t('timeline.elapsed')}</dt>
                <dd className="font-semibold">
                  {event.elapsedSec === null
                    ? t('timeline.noRecord')
                    : t('timeline.seconds', {
                        formattedCount: formatCount(event.elapsedSec)
                      })}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted">{t('timeline.questionVersion')}</dt>
                <dd className="break-all font-mono text-xs" translate="no">
                  {event.questionVersionId}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted">{t('timeline.algorithm')}</dt>
                <dd className="font-semibold" translate="no">
                  {t('timeline.algorithmVersion', {
                    version: event.algorithmVersion
                  })}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
      {historyQuery.isFetchNextPageError ? (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900"
          role="alert"
        >
          {t('timeline.moreError')}
        </p>
      ) : null}
      {historyQuery.hasNextPage ? (
        <Button
          ref={loadMoreButtonRef}
          className="mt-5"
          variant="outline"
          isLoading={historyQuery.isFetchingNextPage || isHistoryPaused}
          loadingLabel={
            isHistoryPaused
              ? t('timeline.waitingConnection')
              : t('timeline.loadingMore')
          }
          onClick={() => {
            previousItemCountRef.current = items.length
            focusNewItemsRef.current = true
            focusRetryRef.current = true
            void historyQuery.fetchNextPage()
          }}
        >
          {t('timeline.loadMore')}
        </Button>
      ) : (
        <p className="mt-4 text-sm text-muted">{t('timeline.complete')}</p>
      )}
    </div>
  )
}

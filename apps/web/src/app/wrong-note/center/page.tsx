import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Pagination } from '@nihongo/browser/common/components/Pagination'
import { GuestReview } from '@app/wrong-note/center/GuestReview'
import { RecentResultsDisclosure } from '@app/wrong-note/center/RecentResultsDisclosure'
import { ReviewQueueFilters } from '@app/wrong-note/center/ReviewQueueFilters'
import { ReviewQueueItem } from '@app/wrong-note/center/ReviewQueueItem'
import { useReviewCenterController } from '@app/wrong-note/hooks/useReviewCenterController'
import { createReviewQueueSearch } from '@app/wrong-note/reviewQueueSearch'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import {
  formatDateTime,
  formatNumber
} from '@nihongo/browser/libs/localeFormatters'
import { useTrackWrongNoteOpened } from '@/analytics/client'
import { AppErrorReportButton } from '@app/question-report/components/AppErrorReportDialog'

const MemberReview = (): ReactElement => {
  useTrackWrongNoteOpened('REVIEW_CENTER')
  const { i18n, t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const count = (value: number): string => formatNumber(value, locale)
  const date = (value: string): string =>
    formatDateTime(value, locale, { dateStyle: 'medium' })
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const rowLinks = useRef(new Map<string, HTMLAnchorElement>())
  const center = useReviewCenterController({
    heading,
    resultHeading,
    rowLinks
  })
  const { correcting, isEmptyPlaceholder, query, queue } = center

  return (
    <section className="review-hub">
      <h1 ref={heading} className="review-title" tabIndex={-1}>
        {t('integration.title')}
      </h1>
      <ReviewQueueFilters
        expanded={center.expanded}
        hasAdvancedFilters={center.hasAdvancedFilters}
        onChange={(key, value) => center.setValue(key, value)}
        onReset={center.reset}
        onToggleAdvanced={center.toggleAdvanced}
        query={query}
        visibleTags={center.visibleTags}
      />
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
          action={
            <div className="flex flex-wrap gap-2">
              <Button onClick={center.retry}>{commonT('actions.retry')}</Button>
              <AppErrorReportButton />
            </div>
          }
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
                <ReviewQueueItem
                  key={item.questionId}
                  item={item}
                  returnTo={center.returnTo}
                  linkRef={(node) => {
                    if (node) rowLinks.current.set(item.questionId, node)
                    else rowLinks.current.delete(item.questionId)
                  }}
                />
              ))}
            </ol>
          ) : (
            <EmptyState
              title={t(`integration.${center.emptyVariant}.title`)}
              description={t(`integration.${center.emptyVariant}.description`)}
              action={
                <div className="review-empty-actions">
                  {center.hasFilters ? (
                    <Button onClick={center.reset}>
                      {t('integration.reset')}
                    </Button>
                  ) : !center.allEmpty ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        center.setValue(
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
              totalPages={center.totalPages}
              requestedPage={query.page}
              disabled={
                queue.isFetching ||
                queue.isError ||
                queue.isPlaceholderData ||
                queue.fetchStatus === 'paused'
              }
              className="review-pagination"
              onPageChange={(page) => center.setValue('page', page)}
              getPageHref={(page) =>
                `?${createReviewQueueSearch({ ...query, page }).toString()}`
              }
              label={t('center.results.pagination')}
            />
          ) : null}
        </>
      ) : null}
      <RecentResultsDisclosure formatCount={count} formatDate={date} />
    </section>
  )
}

export const WrongNoteReviewCenterPage = (): ReactElement => {
  const { isReady, role, user } = useAuth()
  const { t } = useTranslation('wrongNote')
  if (!isReady) return <LoadingState message={t('center.states.loading')} />
  return role === 'GUEST' ? <GuestReview /> : <MemberReview key={user?.id} />
}

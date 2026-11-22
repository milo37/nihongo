import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { WrongNoteReviewState } from '@nihongo/contracts/wrong-note/list-review-list'
import { Button } from '@nihongo/browser/common/components/Button'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Pagination } from '@nihongo/browser/common/components/Pagination'
import { GuestReview } from '@app/wrong-note/center/GuestReview'
import { LevelChips } from '@app/wrong-note/center/LevelChips'
import { ReviewEmpty } from '@app/wrong-note/center/ReviewEmpty'
import { ReviewNotices } from '@app/wrong-note/center/ReviewNotices'
import { ReviewList } from '@app/wrong-note/center/ReviewList'
import { ReviewTabs } from '@app/wrong-note/center/ReviewTabs'
import { useReviewListController } from '@app/wrong-note/hooks/useReviewListController'
import { useStartReview } from '@app/wrong-note/hooks/useStartReview'
import { createReviewListSearch } from '@app/wrong-note/reviewListSearch'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatDateTime } from '@nihongo/browser/libs/localeFormatters'
import { useTrackWrongNoteOpened } from '@/analytics/client'

const MemberReview = (): ReactElement => {
  useTrackWrongNoteOpened('REVIEW_CENTER')
  const { i18n, t } = useTranslation('wrongNote')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const date = (value: string): string =>
    formatDateTime(value, locale, { month: 'long', day: 'numeric' })
  // 'ja' gives 11/10 in either UI language.
  const shortDate = (value: string): string =>
    formatDateTime(value, 'ja', { month: 'numeric', day: 'numeric' })
  const tabs = useRef(new Map<WrongNoteReviewState, HTMLButtonElement>())
  const rowLinks = useRef(new Map<string, HTMLAnchorElement>())
  const center = useReviewListController(rowLinks)
  const { counts, empty, list, query } = center
  const review = useStartReview(() => void list.refetch())
  const canStart =
    query.state === 'TO_REVIEW' && Boolean(list.data?.counts.toReview)
  const isLoading =
    (list.isPending || !counts || center.correcting) &&
    list.fetchStatus !== 'paused' &&
    !list.isError

  const startButton = (className: string): ReactElement => (
    <Button
      className={className}
      disabled={!list.data?.oldestToReview || list.isFetching}
      isLoading={review.isPending}
      onClick={() => review.start(list.data?.oldestToReview ?? null)}
    >
      {t('start')}
    </Button>
  )
  return (
    <section className="wrong-note-center">
      <h1 className="wrong-note-title">{t('title')}</h1>
      <ReviewTabs
        counts={counts}
        locale={locale}
        selected={query.state}
        tabs={tabs}
        onSelect={(state) => center.setQuery({ state })}
      />
      <div
        id="review-panel"
        role="tabpanel"
        aria-labelledby={`review-tab-${query.state}`}
      >
        <p className="wrong-note-rule">{t('rule')}</p>
        {center.showLevels ? (
          <LevelChips
            selected={query.level}
            onSelect={(level) => center.setQuery({ level })}
          />
        ) : null}
        {canStart ? startButton('wrong-note-start-narrow') : null}
        <ReviewNotices
          notice={review.notice}
          offline={list.fetchStatus === 'paused'}
        />
        {isLoading ? (
          <LoadingState message={t('center.states.loading')} />
        ) : null}
        {list.isError ? (
          <ErrorState
            className="wrong-note-block"
            title={t('loadError')}
            description={t('center.states.errorDescription')}
            action={
              <Button onClick={() => void list.refetch()}>{t('retry')}</Button>
            }
          />
        ) : null}
        {list.data && !isLoading && !list.isError ? (
          <>
            {canStart ? (
              <div className="wrong-note-start-row">{startButton('')}</div>
            ) : null}
            {list.data.items.length ? (
              <ReviewList
                busy={list.isFetching}
                formatDate={date}
                formatShortDate={shortDate}
                items={list.data.items}
                returnTo={center.returnTo}
                rowLinks={rowLinks}
                state={query.state}
              />
            ) : empty ? (
              <ReviewEmpty
                empty={empty}
                level={query.level}
                startButton={startButton('')}
                onShowAll={() => center.setQuery({ level: undefined })}
              />
            ) : null}
            {center.totalPages > 1 ? (
              <Pagination
                currentPage={list.data.page}
                totalPages={center.totalPages}
                requestedPage={query.page}
                disabled={list.isFetching || list.isPlaceholderData}
                className="wrong-note-block"
                onPageChange={(page) => center.setQuery({ page })}
                getPageHref={(page) =>
                  `?${createReviewListSearch({ ...query, page }).toString()}`
                }
                label={t('center.results.pagination')}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  )
}

export const WrongNoteReviewCenterPage = (): ReactElement => {
  const { isReady, role, user } = useAuth()
  const { t } = useTranslation('wrongNote')
  if (!isReady) return <LoadingState message={t('center.states.loading')} />
  return role === 'GUEST' ? <GuestReview /> : <MemberReview key={user?.id} />
}

import { EmptySheet } from '@common/components/manuscript/EmptySheet'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { KeyboardEvent, ReactElement } from 'react'
import { jlptLevelSchema } from '@nihongo/contracts/common/enum'
import type { WrongNoteReviewState } from '@nihongo/contracts/wrong-note/list-review-list'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Pagination } from '@nihongo/browser/common/components/Pagination'
import { AccountRestrictedNotice } from '@common/components/AccountRestrictedNotice'
import { GuestReview } from '@app/wrong-note/center/GuestReview'
import { ReviewListItem } from '@app/wrong-note/center/ReviewListItem'
import { useReviewListController } from '@app/wrong-note/hooks/useReviewListController'
import { useStartReview } from '@app/wrong-note/hooks/useStartReview'
import { createReviewListSearch } from '@app/wrong-note/reviewListSearch'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import {
  formatDateTime,
  formatNumber
} from '@nihongo/browser/libs/localeFormatters'
import { useTrackWrongNoteOpened } from '@/analytics/client'

const STATES: readonly WrongNoteReviewState[] = ['TO_REVIEW', 'REVIEWED']
const TAB_KEYS = { TO_REVIEW: 'toReview', REVIEWED: 'reviewed' } as const

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

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = query.state === 'TO_REVIEW' ? 'REVIEWED' : 'TO_REVIEW'
    center.setQuery({ state: next })
    tabs.current.get(next)?.focus()
  }

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
  const startNew = (
    <Link className={getButtonClassName()} to="/practice">
      {t('empty.startNew')}
    </Link>
  )

  return (
    <section className="mx-auto w-full max-w-[1040px] px-4 py-6 sm:px-6 sm:py-10 lg:px-0">
      <h1 className="text-2xl font-bold text-ink">{t('title')}</h1>
      <div
        role="tablist"
        aria-label={t('title')}
        className="mt-4 grid grid-cols-2 border-b border-line"
      >
        {STATES.map((state) => {
          const selected = query.state === state
          return (
            <button
              key={state}
              ref={(node) => {
                if (node) tabs.current.set(state, node)
                else tabs.current.delete(state)
              }}
              id={`review-tab-${state}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="review-panel"
              tabIndex={selected ? 0 : -1}
              className={`-mb-px min-h-12 border-b-[3px] text-[15px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                selected
                  ? 'border-brand font-bold text-ink'
                  : 'border-transparent font-semibold text-muted'
              }`}
              onClick={() => center.setQuery({ state })}
              onKeyDown={onTabKeyDown}
            >
              {t(`tabs.${TAB_KEYS[state]}`, {
                count: counts?.[TAB_KEYS[state]] ?? 0,
                formattedCount: formatNumber(
                  counts?.[TAB_KEYS[state]] ?? 0,
                  locale
                )
              })}
            </button>
          )
        })}
      </div>
      <div
        id="review-panel"
        role="tabpanel"
        aria-labelledby={`review-tab-${query.state}`}
      >
        <p className="mt-3 text-sm text-muted">{t('rule')}</p>
        {center.showLevels ? (
          <div
            role="group"
            aria-label={t('levelLabel')}
            className="mt-4 flex flex-wrap gap-2"
          >
            {[undefined, ...jlptLevelSchema.options].map((level) => {
              const selected = query.level === level
              return (
                <button
                  key={level ?? 'all'}
                  type="button"
                  aria-pressed={selected}
                  className={`relative min-h-9 rounded-full border px-3 text-sm before:absolute before:-inset-1 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                    selected
                      ? 'border-brand-strong bg-brand-soft font-bold text-ink shadow-none'
                      : 'border-line bg-surface font-semibold text-muted'
                  }`}
                  onClick={() => center.setQuery({ level })}
                >
                  {level ?? t('levelAll')}
                </button>
              )
            })}
          </div>
        ) : null}
        {canStart ? startButton('mt-4 min-h-12 w-full sm:hidden') : null}
        {list.fetchStatus === 'paused' ? (
          <p className="mt-4 text-sm font-semibold text-muted" role="status">
            {t('center.states.offline')}
          </p>
        ) : null}
        {review.notice === 'accountRestricted' ? (
          <AccountRestrictedNotice className="mt-4" focusOnMount />
        ) : review.notice ? (
          <p className="mt-4 text-sm font-semibold text-danger" role="alert">
            {t(review.notice === 'empty' ? 'startEmpty' : 'startError')}
          </p>
        ) : null}
        {isLoading ? (
          <LoadingState message={t('center.states.loading')} />
        ) : null}
        {list.isError ? (
          <ErrorState
            className="mt-6"
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
              <div className="mt-6 hidden justify-end sm:flex">
                {startButton('min-h-10')}
              </div>
            ) : null}
            {list.data.items.length ? (
              <div className="mt-2 overflow-hidden rounded-card border border-line bg-surface">
                {/* PC column heads; each row already reads in full, so the
                    heads are for sighted users only. */}
                <div
                  aria-hidden="true"
                  className="hidden h-10 grid-cols-[150px_minmax(0,1fr)_120px_110px_20px] items-center gap-5 border-b border-line px-6 text-caption font-semibold text-muted lg:grid"
                >
                  <span>{t('list.head.levelSubject')}</span>
                  <span>{t('list.head.question')}</span>
                  <span className="text-right">
                    {query.state === 'TO_REVIEW'
                      ? t('list.head.wrongCount')
                      : null}
                  </span>
                  <span className="text-right">
                    {query.state === 'TO_REVIEW'
                      ? t('list.head.wrongDate')
                      : t('list.head.reviewedDate')}
                  </span>
                </div>
                <ol aria-busy={list.isFetching}>
                  {list.data.items.map((item) => (
                    <ReviewListItem
                      key={item.questionId}
                      item={item}
                      formatDate={date}
                      formatShortDate={shortDate}
                      returnTo={center.returnTo}
                      linkRef={(node) => {
                        if (node) rowLinks.current.set(item.questionId, node)
                        else rowLinks.current.delete(item.questionId)
                      }}
                    />
                  ))}
                </ol>
              </div>
            ) : empty === 'levelNone' ? (
              <div className="mt-8 flex flex-col items-start gap-3">
                <p className="text-base text-ink">
                  {t('empty.levelNone', { level: query.level })}
                </p>
                <Button
                  variant="outline"
                  onClick={() => center.setQuery({ level: undefined })}
                >
                  {t('empty.showAll')}
                </Button>
              </div>
            ) : empty ? (
              <EmptySheet word="間違いノート">
                <EmptyState
                  title={t(`empty.${empty}.title`)}
                  description={t(`empty.${empty}.body`)}
                  action={empty === 'noReviewed' ? startButton('') : startNew}
                />
              </EmptySheet>
            ) : null}
            {center.totalPages > 1 ? (
              <Pagination
                currentPage={list.data.page}
                totalPages={center.totalPages}
                requestedPage={query.page}
                disabled={list.isFetching || list.isPlaceholderData}
                className="mt-6"
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

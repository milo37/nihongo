import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { ReviewListItem as ReviewListEntry } from '@nihongo/contracts/wrong-note/list-review-list'
import { Icon } from '@nihongo/browser/common/components/Icon'

type ReviewListItemProps = {
  item: ReviewListEntry
  formatDate: (value: string) => string
  /** Phone reviewed column: month/day only, e.g. 11/10. */
  formatShortDate: (value: string) => string
  linkRef: (node: HTMLAnchorElement | null) => void
  returnTo: string
}

/** One-line row (listgacha 시안 ①): phone 52px, 1024px and up 56px with a date column. */
export const ReviewListItem = ({
  item,
  formatDate,
  formatShortDate,
  linkRef,
  returnTo
}: ReviewListItemProps): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  const toReview = item.reviewState === 'TO_REVIEW'
  const reviewedMeta = t('card.reviewedMeta', {
    date: formatDate(item.lastReviewedAt ?? item.lastWrongAt)
  })
  return (
    <li className="border-t border-line first:border-t-0">
      <Link
        ref={linkRef}
        className="grid h-[52px] grid-cols-[66px_minmax(0,1fr)_auto_16px] items-center gap-2 px-3 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand lg:h-14 lg:grid-cols-[150px_minmax(0,1fr)_120px_110px_20px] lg:gap-5 lg:px-6"
        to={`/wrong-notes/${item.questionId}?returnTo=${encodeURIComponent(returnTo)}`}
      >
        <span className="min-w-0 truncate text-caption font-semibold leading-tight text-muted lg:text-sm">
          <span className="block font-bold text-ink lg:inline">
            {item.level}
            <span className="hidden lg:inline"> · </span>
          </span>
          {commonT(`taxonomy.subjects.${item.subject}`)}
        </span>
        <span
          className="min-w-0 truncate text-[15px] font-semibold text-ink lg:text-base"
          lang="ja"
        >
          {item.questionPreview}
        </span>
        {toReview ? (
          <span className="flex items-center justify-end gap-1 whitespace-nowrap text-[13px] font-bold text-danger">
            <Icon name="x" className="size-3.5" />
            {/* Phones show the number only; the full text stays for screen readers. */}
            <span aria-hidden="true" className="lg:hidden">
              {item.wrongCount}
            </span>
            <span className="sr-only lg:not-sr-only">
              {t('card.wrongCount', { count: item.wrongCount })}
            </span>
          </span>
        ) : (
          <span className="flex items-center justify-end gap-1 whitespace-nowrap text-[13px] font-bold text-success-strong lg:invisible">
            <span aria-hidden="true">○</span>
            <span aria-hidden="true">
              {formatShortDate(item.lastReviewedAt ?? item.lastWrongAt)}
            </span>
            <span className="sr-only">{reviewedMeta}</span>
          </span>
        )}
        <span className="hidden text-right text-[13px] text-muted lg:block">
          {toReview ? formatDate(item.lastWrongAt) : reviewedMeta}
        </span>
        <Icon name="chevron-right" className="size-4 text-muted" />
      </Link>
    </li>
  )
}

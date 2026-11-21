import { GradeSquare } from '@common/components/manuscript/GradeSquare'
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
    <li className="wrong-note-item">
      <Link
        ref={linkRef}
        className="wrong-note-item-link"
        to={`/wrong-notes/${item.questionId}?returnTo=${encodeURIComponent(returnTo)}`}
      >
        <span className="wrong-note-item-meta">
          <span className="wrong-note-item-level">
            {item.level}
            <span className="wrong-note-item-dot"> · </span>
          </span>
          {commonT(`taxonomy.subjects.${item.subject}`)}
        </span>
        <span className="wrong-note-item-title" lang="ja">
          {item.questionPreview}
        </span>
        {toReview ? (
          <span className="wrong-note-item-wrong">
            {/* Wrong is the slash square everywhere (B4 §4). */}
            <GradeSquare grade="ng" className="review-list-grade" />
            {/* Phones show the number only; the full text stays for screen readers. */}
            <span aria-hidden="true" className="wrong-note-item-short">
              {item.wrongCount}
            </span>
            <span className="wrong-note-item-long">
              {t('card.wrongCount', { count: item.wrongCount })}
            </span>
          </span>
        ) : (
          <span className="wrong-note-item-reviewed">
            <span aria-hidden="true">○</span>
            <span aria-hidden="true">
              {formatShortDate(item.lastReviewedAt ?? item.lastWrongAt)}
            </span>
            <span className="sr-only">{reviewedMeta}</span>
          </span>
        )}
        <span className="wrong-note-item-date">
          {toReview ? formatDate(item.lastWrongAt) : reviewedMeta}
        </span>
        <Icon name="chevron-right" className="wrong-note-item-chevron" />
      </Link>
    </li>
  )
}

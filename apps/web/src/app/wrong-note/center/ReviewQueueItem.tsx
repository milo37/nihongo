import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { useListReviewQueue } from '@app/wrong-note/hooks/useListReviewQueue'
import { ReviewStatus } from '@app/wrong-note/components/ReviewStatus'

type ReviewQueueEntry = NonNullable<
  ReturnType<typeof useListReviewQueue>['data']
>['items'][number]

type ReviewQueueItemProps = {
  item: ReviewQueueEntry
  linkRef: (node: HTMLAnchorElement | null) => void
  returnTo: string
}

export const ReviewQueueItem = ({
  item,
  linkRef,
  returnTo
}: ReviewQueueItemProps): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  return (
    <li className="review-item">
      <div className="review-item-meta">
        <span>
          {item.level} · {commonT(`taxonomy.subjects.${item.subject}`)}
          <span className="review-row-tags">
            {item.tags.length ? ` · ${item.tags.join(' · ')}` : ''}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {item.hasMemo ? (
            <span className="rounded-full border border-current bg-brand-soft px-2 py-0.5 text-xs font-bold text-link">
              {t('center.results.hasMemo')}
            </span>
          ) : null}
          <ReviewStatus status={item.status} />
        </span>
      </div>
      <Link
        ref={linkRef}
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
  )
}

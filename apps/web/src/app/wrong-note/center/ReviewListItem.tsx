import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { ReviewListItem as ReviewListEntry } from '@nihongo/contracts/wrong-note/list-review-list'
import { Icon } from '@nihongo/browser/common/components/Icon'

type ReviewListItemProps = {
  item: ReviewListEntry
  formatDate: (value: string) => string
  linkRef: (node: HTMLAnchorElement | null) => void
  returnTo: string
}

export const ReviewListItem = ({
  item,
  formatDate,
  linkRef,
  returnTo
}: ReviewListItemProps): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        ref={linkRef}
        className="flex min-h-11 items-center gap-3 py-4 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        to={`/wrong-notes/${item.questionId}?returnTo=${encodeURIComponent(returnTo)}`}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-semibold text-muted">
            {item.level} · {commonT(`taxonomy.subjects.${item.subject}`)}
          </span>
          <span
            className="line-clamp-2 text-base text-ink sm:text-[17px]"
            lang="ja"
          >
            {item.questionPreview}
          </span>
          <span className="text-[13px] text-muted">
            {item.reviewState === 'TO_REVIEW' ? (
              <>
                <span className="font-semibold text-danger">
                  {t('card.wrongCount', { count: item.wrongCount })}
                </span>
                {' · '}
                {formatDate(item.lastWrongAt)}
              </>
            ) : (
              t('card.reviewedMeta', {
                date: formatDate(item.lastReviewedAt ?? item.lastWrongAt)
              })
            )}
          </span>
        </span>
        <Icon name="chevron-right" className="shrink-0 text-muted" />
      </Link>
    </li>
  )
}

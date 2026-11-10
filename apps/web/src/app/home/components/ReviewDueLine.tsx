import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

/**
 * Members only: how many wrong answers wait for review, with a link to the
 * wrong-note list. Nothing while loading, on error or when none are left.
 */
export const ReviewDueLine = (): ReactElement | null => {
  const { t } = useTranslation('home')
  const list = useQuery(
    wrongNoteQueries.reviewList({ state: 'TO_REVIEW', pageSize: 1 })
  )
  const toReview = list.data?.counts.toReview ?? 0
  if (toReview === 0) return null
  return (
    <p className="home-more">
      <Icon name="rotate-ccw" className="home-more-icon" />
      {t('today.dueLabel', { count: toReview })}
      <Link to="/wrong-notes">
        {t('today.dueLink')}
        <Icon name="chevron-right" className="size-4" />
      </Link>
    </p>
  )
}

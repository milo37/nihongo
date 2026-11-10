import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { AccountRestrictedNotice } from '@common/components/AccountRestrictedNotice'
import { useReviewDue } from '@app/dashboard/hooks/useReviewDue'
import { useStartReview } from '@app/wrong-note/hooks/useStartReview'

/**
 * Members only (first screen B, JLP-823): how many wrong answers wait, and
 * [복습] that starts the same review as the wrong-note [복습 시작]. Nothing
 * while loading, on error or when none are left.
 */
export const ReviewDueLine = (): ReactElement | null => {
  const { t } = useTranslation('home')
  const { t: wrongNoteT } = useTranslation('wrongNote')
  const due = useReviewDue()
  const review = useStartReview(() => void due.refetch())
  if (due.count === 0 && !review.notice) return null
  return (
    <>
      {due.count > 0 ? (
        <p className="home-more">
          <Icon name="rotate-ccw" className="home-more-icon" />
          {t('today.dueLabel', { count: due.count })}
          <Button
            variant="ghost"
            className="home-more-action"
            disabled={!due.oldestToReview}
            isLoading={review.isPending}
            loadingLabel={t('approved.loading')}
            onClick={() => review.start(due.oldestToReview)}
          >
            {t('today.dueAction')}
            <Icon name="chevron-right" className="size-4" />
          </Button>
        </p>
      ) : null}
      {review.notice === 'accountRestricted' ? (
        <AccountRestrictedNotice className="mt-3" focusOnMount />
      ) : review.notice ? (
        <p className="mt-3 text-sm font-semibold text-danger" role="alert">
          {wrongNoteT(review.notice === 'empty' ? 'startEmpty' : 'startError')}
        </p>
      ) : null}
    </>
  )
}

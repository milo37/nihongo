import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'
import {
  useErrorToast,
  useToast
} from '@nihongo/browser/common/components/Toast'
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
  useErrorToast(
    review.notice === 'error' ? wrongNoteT('startError') : null,
    'set-create'
  )
  // #1292: nothing left to review is news, not an error: an info toast.
  const { addToast } = useToast()
  const isEmpty = review.notice === 'empty'
  useEffect(() => {
    if (isEmpty)
      addToast({
        key: 'set-create',
        title: wrongNoteT('startEmpty'),
        variant: 'info'
      })
  }, [isEmpty, addToast, wrongNoteT])
  if (due.count === 0 && review.notice !== 'accountRestricted') return null
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
            <Icon name="chevron-right" className="home-more-chevron" />
          </Button>
        </p>
      ) : null}
      {review.notice === 'accountRestricted' ? (
        <AccountRestrictedNotice className="home-more-notice" focusOnMount />
      ) : null}
    </>
  )
}

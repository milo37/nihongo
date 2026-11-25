import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { useErrorToast } from '@common/hooks/useErrorToast'
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
  if (due.count === 0 && (!review.notice || review.notice === 'error'))
    return null
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
      ) : review.notice === 'empty' ? (
        <p className="home-more-error" role="alert">
          {wrongNoteT('startEmpty')}
        </p>
      ) : null}
    </>
  )
}

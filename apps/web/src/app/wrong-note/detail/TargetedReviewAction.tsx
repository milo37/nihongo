import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import type { useTargetedReviewStart } from '@app/wrong-note/hooks/useTargetedReviewStart'
import { useErrorToast } from '@common/hooks/useErrorToast'
import { AccountRestrictedNotice } from '@common/components/AccountRestrictedNotice'
import { QuestionReportDialog } from '@app/question-report/components/QuestionReportDialog'

type TargetedReviewActionProps = {
  data: WrongNoteDetailView
  isStartDisabled: boolean
  targeted: ReturnType<typeof useTargetedReviewStart>
}

export const TargetedReviewAction = ({
  data,
  isStartDisabled,
  targeted
}: TargetedReviewActionProps): ReactElement => {
  const { t } = useTranslation('wrongNote')
  useErrorToast(
    targeted.isError && !targeted.isAccountRestricted
      ? t(
          targeted.isUnavailableError
            ? 'detail.targeted.unavailable'
            : 'detail.targeted.error'
        )
      : null,
    'set-create'
  )
  const { reviewAvailability } = data.wrongNote
  const isArchived = reviewAvailability === 'ARCHIVED'
  return (
    <>
      {reviewAvailability === 'AVAILABLE' || targeted.hasRecoveryAttempt ? (
        <>
          <Button
            fullWidth
            disabled={isStartDisabled}
            isLoading={targeted.isPending}
            loadingLabel={
              targeted.isPaused
                ? t('detail.targeted.waitingConnection')
                : t('detail.targeted.loading')
            }
            onClick={() => targeted.start(reviewAvailability)}
          >
            {isArchived
              ? t('detail.targeted.recover')
              : t('detail.targeted.start')}
          </Button>
          {isArchived ? (
            <p className="wrong-note-action-notice">
              {t('detail.targeted.archivedRecovery')}
            </p>
          ) : null}
          {targeted.isPaused ? (
            <p className="wrong-note-action-warn" role="status">
              {t('detail.targeted.offline')}
            </p>
          ) : null}
          {targeted.isError && targeted.isAccountRestricted ? (
            <AccountRestrictedNotice
              className="wrong-note-action-restricted"
              focusOnMount
            />
          ) : null}
        </>
      ) : (
        <p className="wrong-note-action-text">
          {t('detail.targeted.archivedOnly')}
        </p>
      )}
      <p className="wrong-note-action-status" aria-live="polite">
        {targeted.noticeCode ? t(`detail.targeted.${targeted.noticeCode}`) : ''}
      </p>
      {/* Reporting is rare here: a small text link under the action (G). */}
      {data.question.questionVersionId ? (
        <QuestionReportDialog
          questionId={data.question.id}
          questionVersionId={data.question.questionVersionId}
          ordinal={1}
          trigger="link"
          triggerLabel={t('detail.report')}
        />
      ) : null}
    </>
  )
}

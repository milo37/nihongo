import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import type { useTargetedReviewStart } from '@app/wrong-note/hooks/useTargetedReviewStart'
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
            <p className="mt-3 text-sm font-semibold text-muted">
              {t('detail.targeted.archivedRecovery')}
            </p>
          ) : null}
          {targeted.isPaused ? (
            <p
              className="mt-3 text-sm font-semibold text-amber-900"
              role="status"
            >
              {t('detail.targeted.offline')}
            </p>
          ) : null}
          {targeted.isError && targeted.isAccountRestricted ? (
            <AccountRestrictedNotice className="mt-3" focusOnMount />
          ) : targeted.isError ? (
            <p className="mt-3 text-sm font-semibold text-red-800" role="alert">
              {targeted.isUnavailableError
                ? t('detail.targeted.unavailable')
                : t('detail.targeted.error')}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm font-semibold text-muted">
          {t('detail.targeted.archivedOnly')}
        </p>
      )}
      <p
        className="mt-3 min-h-6 text-sm font-semibold text-muted"
        aria-live="polite"
      >
        {targeted.noticeCode ? t(`detail.targeted.${targeted.noticeCode}`) : ''}
      </p>
      {/* Reporting is rare here: a small text link under the action (G). */}
      {data.question.questionVersionId ? (
        <QuestionReportDialog
          questionId={data.question.id}
          questionVersionId={data.question.questionVersionId}
          ordinal={1}
          trigger="link"
        />
      ) : null}
    </>
  )
}

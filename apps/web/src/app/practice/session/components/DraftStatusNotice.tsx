import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { formatDateTime } from '@nihongo/browser/libs/localeFormatters'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'
import type { PracticeSessionNoticesProps as Props } from '@app/practice/session/components/PracticeSessionNotices'

/** Draft save status with conflict-check note and a retry when saving failed. */
export const DraftStatusNotice = ({
  draftController,
  hasUnresolvedConflictCheck,
  isCompactDraftStatus,
  onRetryDraftSave
}: Pick<
  Props,
  | 'draftController'
  | 'hasUnresolvedConflictCheck'
  | 'isCompactDraftStatus'
  | 'onRetryDraftSave'
>): ReactElement => {
  const { t } = useTranslation('practice')
  const { locale } = usePracticeNumberFormat()
  const draftStatusMessage = t(
    `session.draft.status.${draftController.status.code}`,
    draftController.status.savedAt
      ? {
          time: formatDateTime(draftController.status.savedAt, locale, {
            hour: '2-digit',
            minute: '2-digit'
          })
        }
      : undefined
  )
  return (
    <div
      className={
        isCompactDraftStatus
          ? 'mt-2 text-caption leading-5 text-muted'
          : 'mt-4 rounded-lg border border-info-line bg-info-soft px-4 py-3 text-sm font-semibold leading-6 text-info-strong'
      }
      role="status"
      aria-live="polite"
      data-save-state={draftController.saveState}
    >
      <p>{draftStatusMessage}</p>
      {hasUnresolvedConflictCheck ? (
        <p className="mt-2 font-medium">
          {t('session.draft.conflictCheckPending')}
        </p>
      ) : null}
      {draftController.saveState === 'error' ||
      draftController.saveState === 'offline' ? (
        <Button
          className="mt-3"
          size="sm"
          variant="secondary"
          onClick={onRetryDraftSave}
        >
          {t('session.draft.retry')}
        </Button>
      ) : null}
    </div>
  )
}

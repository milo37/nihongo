import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { formatDateTime } from '@nihongo/browser/libs/localeFormatters'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'
import type { PracticeSessionNoticesProps as Props } from '@app/practice/session/components/PracticeSessionNotices'

/** Draft status while the latest answers are checked (#1262: a failed or
 offline save is a toast, StudyDraftSaveStatus). */
export const DraftStatusNotice = ({
  draftController,
  hasUnresolvedConflictCheck,
  isCompactDraftStatus
}: Pick<
  Props,
  'draftController' | 'hasUnresolvedConflictCheck' | 'isCompactDraftStatus'
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
        isCompactDraftStatus ? 'study-draft-compact' : 'study-draft-notice'
      }
      role="status"
      aria-live="polite"
      data-save-state={draftController.saveState}
    >
      <p>{draftStatusMessage}</p>
      {hasUnresolvedConflictCheck ? (
        <p className="study-draft-pending">
          {t('session.draft.conflictCheckPending')}
        </p>
      ) : null}
    </div>
  )
}

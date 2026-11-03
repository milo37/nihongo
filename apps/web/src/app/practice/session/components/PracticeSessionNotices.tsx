import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { formatDateTime } from '@nihongo/browser/libs/localeFormatters'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import type { PracticeDraftController } from '@app/practice/hooks/usePracticeDraftController'
import type { DraftActionNoticeCode } from '@app/practice/hooks/usePracticeSessionController'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'

type PracticeSessionNoticesProps = {
  draftActionMessage: DraftActionNoticeCode | null
  draftController: PracticeDraftController
  hasUnresolvedConflictCheck: boolean
  isCompactDraftStatus: boolean
  isInlineDraftStatus: boolean
  isSessionError: boolean
  isSessionPaused: boolean
  isV2Session: boolean
  onRetryDraftSave: () => void
  onRetrySession: () => void
  sessionData: StudySessionView
}

export const PracticeSessionNotices = ({
  draftActionMessage,
  draftController,
  hasUnresolvedConflictCheck,
  isCompactDraftStatus,
  isInlineDraftStatus,
  isSessionError,
  isSessionPaused,
  isV2Session,
  onRetryDraftSave,
  onRetrySession,
  sessionData
}: PracticeSessionNoticesProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const { formatCount, locale } = usePracticeNumberFormat()
  const { session, requestedCount, actualCount, usedFallback } = sessionData
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
  const isDraftActionInformational =
    draftActionMessage === 'conflictRefreshComplete'

  return (
    <>
      {isSessionPaused ? (
        <p
          className="mt-4 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold leading-6 text-warning-strong"
          role="status"
        >
          {t('session.errors.cachedOfflineDescription')}
        </p>
      ) : isSessionError ? (
        <div
          className="mt-4 rounded-lg border border-danger-line bg-danger-soft p-4 text-sm text-danger-strong"
          role="alert"
        >
          <p className="font-semibold">
            {t('session.errors.staleSessionDescription')}
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={onRetrySession}
          >
            {t('session.errors.retrySession')}
          </Button>
        </div>
      ) : null}

      {isV2Session && !isInlineDraftStatus ? (
        <div
          className={
            isCompactDraftStatus
              ? 'mt-2 text-xs leading-5 text-muted'
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
      ) : null}

      {draftActionMessage ? (
        <p
          className={`mt-4 rounded-lg border px-4 py-3 text-sm font-semibold leading-6 ${
            isDraftActionInformational
              ? 'border-info-line bg-info-soft text-info-strong'
              : 'border-danger-line bg-danger-soft text-danger-strong'
          }`}
          role={isDraftActionInformational ? 'status' : 'alert'}
        >
          {t(`session.draft.notices.${draftActionMessage}`)}
        </p>
      ) : null}

      {actualCount < requestedCount || usedFallback ? (
        <div
          className="mt-5 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm text-warning-strong"
          role="status"
        >
          {actualCount < requestedCount
            ? t('session.supply.canonicalPartial', {
                actual: formatCount(actualCount),
                mode: commonT(`taxonomy.studyModes.${session.mode}`),
                requested: formatCount(requestedCount)
              })
            : t('session.supply.canonicalNoFallback')}
        </div>
      ) : null}
    </>
  )
}

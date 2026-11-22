import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import type { PracticeDraftController } from '@app/practice/hooks/usePracticeDraftController'
import type { DraftActionNoticeCode } from '@app/practice/hooks/usePracticeSessionController'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'
import { getSetReturnPath } from '@app/practice/setReturnPath'
import { DraftStatusNotice } from '@app/practice/session/components/DraftStatusNotice'

export type PracticeSessionNoticesProps = {
  draftActionMessage: DraftActionNoticeCode | null
  draftController: PracticeDraftController
  hasUnresolvedConflictCheck: boolean
  isCompactDraftStatus: boolean
  isFirstQuestion: boolean
  isInlineDraftStatus: boolean
  isSessionError: boolean
  isSessionPaused: boolean
  isV2Session: boolean
  onRetryDraftSave: () => void
  onRetrySession: () => void
  sessionData: StudySessionView
}

type Props = PracticeSessionNoticesProps

/** Cached-offline note, or a stale-session alert with a retry button. */
const SessionSourceNotice = ({
  isSessionError,
  isSessionPaused,
  onRetrySession
}: Pick<
  Props,
  'isSessionError' | 'isSessionPaused' | 'onRetrySession'
>): ReactElement | null => {
  const { t } = useTranslation('practice')
  if (isSessionPaused)
    return (
      <p
        className="mt-4 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold leading-6 text-warning-strong"
        role="status"
      >
        {t('session.errors.cachedOfflineDescription')}
      </p>
    )
  if (isSessionError)
    return (
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
    )
  return null
}

/** Explains a session with fewer questions than requested. */
const SupplyNotice = ({
  sessionData
}: {
  sessionData: StudySessionView
}): ReactElement | null => {
  const { t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const { formatCount } = usePracticeNumberFormat()
  const { session, requestedCount, actualCount } = sessionData
  if (actualCount >= requestedCount) return null
  // JLP-858: a wrong-note or bookmark set takes what its list holds; the
  // learner never chose a count, so only a chosen-size set explains a gap.
  if (getSetReturnPath(session.mode)) return null
  return (
    <p className="mb-4 text-[13px] leading-5 text-muted" role="status">
      {t('session.supply.canonicalPartial', {
        actual: formatCount(actualCount),
        mode: commonT(`taxonomy.studyModes.${session.mode}`),
        requested: formatCount(requestedCount)
      })}
    </p>
  )
}

export const PracticeSessionNotices = ({
  draftActionMessage,
  draftController,
  hasUnresolvedConflictCheck,
  isCompactDraftStatus,
  isFirstQuestion,
  isInlineDraftStatus,
  isSessionError,
  isSessionPaused,
  isV2Session,
  onRetryDraftSave,
  onRetrySession,
  sessionData
}: PracticeSessionNoticesProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { requestedCount, actualCount, usedFallback } = sessionData
  const isDraftActionInformational =
    draftActionMessage === 'conflictRefreshComplete'

  return (
    <>
      <SessionSourceNotice
        isSessionError={isSessionError}
        isSessionPaused={isSessionPaused}
        onRetrySession={onRetrySession}
      />

      {isV2Session && !isInlineDraftStatus ? (
        <DraftStatusNotice
          draftController={draftController}
          hasUnresolvedConflictCheck={hasUnresolvedConflictCheck}
          isCompactDraftStatus={isCompactDraftStatus}
          onRetryDraftSave={onRetryDraftSave}
        />
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

      {isFirstQuestion && (actualCount < requestedCount || usedFallback) ? (
        <SupplyNotice sessionData={sessionData} />
      ) : null}
    </>
  )
}

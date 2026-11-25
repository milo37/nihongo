import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { useToast } from '@nihongo/browser/common/components/Toast'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import type { DraftActionNoticeCode } from '@app/practice/hooks/usePracticeSessionController'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'
import { getSetReturnPath } from '@app/practice/setReturnPath'

export type PracticeSessionNoticesProps = {
  draftActionMessage: DraftActionNoticeCode | null
  isFirstQuestion: boolean
  isSessionError: boolean
  onRetrySession: () => void
  sessionData: StudySessionView
}

type Props = PracticeSessionNoticesProps

// #1262: no lines at the top of the question. Offline is the one connection
// toast; a stale session is a toast that stays, with the reload in it.
const SessionSourceNotice = ({
  isSessionError,
  onRetrySession
}: Pick<Props, 'isSessionError' | 'onRetrySession'>): null => {
  const { t } = useTranslation('practice')
  const { addToast, dismissToast } = useToast()
  const retryRef = useRef(onRetrySession)
  useEffect(() => {
    retryRef.current = onRetrySession
  }, [onRetrySession])
  useEffect(() => {
    if (!isSessionError) return
    const id = addToast({
      key: 'session-stale',
      title: t('session.errors.staleSessionDescription'),
      variant: 'warning',
      persistent: true,
      action: {
        label: t('session.errors.retrySession'),
        onClick: () => retryRef.current()
      }
    })
    return () => dismissToast(id)
  }, [retryRef, isSessionError, addToast, dismissToast, t])
  return null
}

/** A failed save, leave or submit step, or a reloaded answer, as a toast. */
const DraftActionToast = ({
  code
}: {
  code: DraftActionNoticeCode | null
}): null => {
  const { t } = useTranslation('practice')
  const { addToast } = useToast()
  useEffect(() => {
    if (code)
      addToast({
        key: 'draft-save',
        title: t(`session.draft.notices.${code}`),
        variant: code === 'conflictRefreshComplete' ? 'info' : 'warning'
      })
  }, [code, addToast, t])
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
    <p className="study-supply-note" role="status">
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
  isFirstQuestion,
  isSessionError,
  onRetrySession,
  sessionData
}: PracticeSessionNoticesProps): ReactElement => {
  const { requestedCount, actualCount, usedFallback } = sessionData

  return (
    <>
      <SessionSourceNotice
        isSessionError={isSessionError}
        onRetrySession={onRetrySession}
      />
      <DraftActionToast code={draftActionMessage} />

      {isFirstQuestion && (actualCount < requestedCount || usedFallback) ? (
        <SupplyNotice sessionData={sessionData} />
      ) : null}
    </>
  )
}

import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { useGuestAction } from '@app/login/hooks/useGuestAction'
import { useResultNumberFormat } from '@app/practice/hooks/useResultNumberFormat'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'

type ResultActionsProps = {
  incorrectCount: number
  isGuest: boolean
  /** A guest's last try today (L20). */
  isGuestDone: boolean
  isRetryDisabled: boolean
  isRetryLoading: boolean
  onRetry: () => void
  retryLoadingLabel: string
  session: StudySessionView['session']
  showRetry: boolean
}

export const ResultActions = ({
  incorrectCount,
  isGuest,
  isGuestDone,
  isRetryDisabled,
  isRetryLoading,
  onRetry,
  retryLoadingLabel,
  session,
  showRetry
}: ResultActionsProps): ReactElement => {
  const { t } = useTranslation('result')
  const { t: authT } = useTranslation('auth')
  const { formatCount } = useResultNumberFormat()
  const guestAction = useGuestAction()
  const loginHref = `/login?redirect=${encodeURIComponent('/practice')}`
  const newPracticeButton = (variant: 'primary' | 'outline'): ReactElement => (
    <Link
      className={getButtonClassName({ variant, size: 'lg' })}
      to="/practice"
    >
      {t('newPractice')}
    </Link>
  )
  return (
    <div className="study-result-actions mt-4 flex flex-col gap-3">
      {/* One login place: beside the L10 line, or in the L20 box. */}
      <p className="text-sm leading-6 text-muted">
        {isGuest
          ? t('status.guest')
          : t('status.savedWrongCount', {
              formattedCount: formatCount(incorrectCount)
            })}
        {isGuest && !isGuestDone ? (
          <Link className="note-link ms-2" to={loginHref}>
            {t('actions.loginChoice')}
          </Link>
        ) : null}
      </p>
      {isGuestDone ? (
        <div className="practice-guest-note" role="status">
          <span>{t('guestDone')}</span>
          <Link
            className={getButtonClassName({ variant: 'outline', size: 'sm' })}
            to={loginHref}
          >
            {authT('guestToast.login')}
          </Link>
        </div>
      ) : null}
      {/* Primary → secondary → text links; layout in styles.css. */}
      <div className="study-result-buttons">
        {isGuest && !isGuestDone ? newPracticeButton('primary') : null}
        {isGuest && incorrectCount > 0 ? (
          // Locked, not hidden: pressing it says why (G4).
          <Button
            size="lg"
            variant="outline"
            onClick={() =>
              guestAction(t('locked.retry'), { sessionNotKept: true })
            }
          >
            {t('actions.retryIncorrect')}
            <span aria-hidden="true">🔒</span>
            <span className="sr-only">{t('memberLocked')}</span>
          </Button>
        ) : !isGuest && showRetry ? (
          <Button
            size="lg"
            disabled={isRetryDisabled}
            isLoading={isRetryLoading}
            loadingLabel={retryLoadingLabel}
            onClick={onRetry}
          >
            {t('actions.retryIncorrect')}
          </Button>
        ) : null}
        {isGuest ? null : newPracticeButton(showRetry ? 'outline' : 'primary')}
        <div className="study-result-links">
          {isGuest ? null : (
            <Link
              className="note-link"
              to={`/wrong-notes?level=${session.level}&subject=${session.subject}&view=UNREVIEWED`}
            >
              {t('actions.openWrongNotes')}
            </Link>
          )}
          <Link className="note-link" to="/bookmarks">
            {t('navigation.openBookmarks')}
          </Link>
          {/* The L20 box replaces the primary; new practice stays as text. */}
          {isGuestDone ? (
            <Link className="note-link" to="/practice">
              {t('newPractice')}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  )
}

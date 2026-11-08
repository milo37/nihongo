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
      <div className="flex flex-wrap gap-2">
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
        ) : showRetry ? (
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
        <Link
          className={getButtonClassName({ variant: 'outline' })}
          to="/bookmarks"
        >
          {t('navigation.openBookmarks')}
        </Link>
        {isGuest ? null : (
          <Link
            className="note-link"
            to={`/wrong-notes?level=${session.level}&subject=${session.subject}&view=UNREVIEWED`}
          >
            {t('actions.openWrongNotes')}
          </Link>
        )}
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-control px-4 py-2.5 text-sm font-semibold text-muted hover:bg-surface-muted focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
          to="/practice"
        >
          {t('newPractice')}
        </Link>
      </div>
    </div>
  )
}

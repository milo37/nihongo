import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { useGuestAction } from '@app/login/hooks/useGuestAction'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'

// Outlined buttons add a border; fix every button at 48px (ux2 §2-4).
const SAME_HEIGHT = 'h-12'

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

/** '다음에 할 일': one filled button, the rest outlined, all 48px; no links. */
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
  const guestAction = useGuestAction()
  const linkButton = (
    to: string,
    label: string,
    variant: 'primary' | 'outline' = 'outline'
  ): ReactElement => (
    <Link
      className={getButtonClassName({
        variant,
        size: 'lg',
        className: SAME_HEIGHT
      })}
      to={to}
    >
      {label}
    </Link>
  )
  return (
    <section
      className="study-result-actions mt-10"
      aria-labelledby="result-next-steps"
    >
      <h2 id="result-next-steps" className="mb-4 text-xl font-bold">
        {t('nextActions.title')}
      </h2>
      {isGuestDone ? (
        <div className="practice-guest-note" role="status">
          <span>{t('guestDone')}</span>
          <Link
            className={getButtonClassName({ variant: 'outline', size: 'sm' })}
            to={`/login?redirect=${encodeURIComponent('/practice')}`}
          >
            {authT('guestToast.login')}
          </Link>
        </div>
      ) : null}
      {/* Stacked full width under 640px, one row at text width above. */}
      <div className="study-result-buttons flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {isGuest
          ? linkButton(
              '/practice',
              t('newPractice'),
              isGuestDone ? 'outline' : 'primary'
            )
          : null}
        {isGuest && incorrectCount > 0 ? (
          // Locked, not hidden: pressing it says why (G4).
          <Button
            className={SAME_HEIGHT}
            size="lg"
            variant="outline"
            onClick={() =>
              guestAction(t('locked.retry'), { sessionNotKept: true })
            }
          >
            {t('actions.retryIncorrect')}
            <Icon name="lock" />
            <span className="sr-only">{t('memberLocked')}</span>
          </Button>
        ) : !isGuest && showRetry ? (
          <Button
            className={SAME_HEIGHT}
            size="lg"
            disabled={isRetryDisabled}
            isLoading={isRetryLoading}
            loadingLabel={retryLoadingLabel}
            onClick={onRetry}
          >
            {t('actions.retryIncorrect')}
          </Button>
        ) : null}
        {isGuest
          ? null
          : linkButton(
              '/practice',
              t('newPractice'),
              showRetry ? 'outline' : 'primary'
            )}
        {isGuest
          ? null
          : linkButton(
              `/wrong-notes?level=${session.level}&subject=${session.subject}&view=UNREVIEWED`,
              t('actions.openWrongNotes')
            )}
        {linkButton('/bookmarks', t('navigation.openBookmarks'))}
      </div>
    </section>
  )
}

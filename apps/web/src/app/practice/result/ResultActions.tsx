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
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { useStartNextSet } from '@app/practice/result/useStartNextSet'
import { PracticeSetupFeedback } from '@app/practice/components/PracticeSetupFeedback'

// Outlined buttons add a border; fix both buttons at 48px (ux2 §2-4).
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

/**
 * '다음에 할 일': two buttons only (subtract table 10). [틀린 문제만 다시
 * 풀기] when something was wrong, then [다음 10문제]; both 48px. The button
 * that works is filled: a member's retry, else the next set. A guest's
 * locked retry stays outlined.
 */
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
  const { i18n, t } = useTranslation('result')
  const { t: authT } = useTranslation('auth')
  const guestAction = useGuestAction()
  const nextSet = useStartNextSet(session, isGuest)
  const isNextSetPrimary = isGuest || !showRetry
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
            className={getButtonClassName({
              size: 'lg',
              className: SAME_HEIGHT
            })}
            to={`/login?redirect=${encodeURIComponent('/practice')}`}
          >
            {authT('guestToast.login')}
          </Link>
        </div>
      ) : null}
      {/* Stacked full width under 640px, one row at text width above. */}
      <div className="study-result-buttons flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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
        {/* A guest with no tries left has only the login above. */}
        {isGuestDone ? null : (
          <Button
            className={SAME_HEIGHT}
            size="lg"
            variant={isNextSetPrimary ? 'primary' : 'outline'}
            isLoading={nextSet.isStarting}
            loadingLabel={t('actions.nextSetStarting')}
            onClick={nextSet.start}
          >
            {t('actions.nextSet', {
              formattedCount: formatNumber(
                nextSet.count,
                resolveUiLocale(i18n.resolvedLanguage)
              )
            })}
          </Button>
        )}
      </div>
      {/* A refused next set says why here, in place (G, #792 QA). */}
      <div className="mt-3" aria-live="polite">
        <PracticeSetupFeedback
          accountRestricted={nextSet.accountRestricted}
          hasCreateError={nextSet.hasCreateError}
          mode="RANDOM"
          noEligibleQuestions={nextSet.noEligibleQuestions}
          onSelectRandom={nextSet.start}
        />
      </div>
    </section>
  )
}

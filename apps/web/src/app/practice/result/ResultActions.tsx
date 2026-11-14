import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { GuestDailyLimitCard } from '@app/practice/components/GuestDailyLimitCard'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { useStartNextSet } from '@app/practice/result/useStartNextSet'
import { PracticeSetupFeedback } from '@app/practice/components/PracticeSetupFeedback'
import { ButtonTriesLeft } from '@app/practice/components/ButtonTriesLeft'
import {
  getSetReturnPath,
  setReturnLabelKey
} from '@app/practice/setReturnPath'

// Outlined buttons add a border; fix both buttons at 48px (ux2 §2-4).
const SAME_HEIGHT = 'h-12'

type ResultActionsProps = {
  isGuest: boolean
  /** A guest's tries left, inside [다음 N문제] (plan-notes §5). */
  guestTriesLeft?: number
  /** A guest's last try today (L20). */
  isGuestDone: boolean
  isRetryDisabled: boolean
  isRetryLoading: boolean
  onRetry: () => void
  retryLoadingLabel: string
  session: StudySessionView['session']
  /** Size of the set just played (members repeat it). */
  requestedCount?: number
  showRetry: boolean
}

/**
 * '다음에 할 일': two buttons only (subtract table 10). [다음 N문제] first
 * and filled, then [틀린 문제만 다시 풀기] when something was wrong; both
 * 48px, the same for members and guests (B4 §11).
 */
export const ResultActions = ({
  guestTriesLeft,
  isGuest,
  isGuestDone,
  isRetryDisabled,
  isRetryLoading,
  onRetry,
  retryLoadingLabel,
  session,
  requestedCount,
  showRetry
}: ResultActionsProps): ReactElement => {
  const { i18n, t } = useTranslation('result')
  const nextSet = useStartNextSet(session, isGuest, requestedCount)
  // JLP-856: a wrong-note or bookmark set goes back to its list instead of
  // offering a random next set.
  const returnPath = isGuest ? null : getSetReturnPath(session.mode)
  return (
    <section
      className="study-result-actions mt-10"
      aria-labelledby="result-next-steps"
    >
      <h2 id="result-next-steps" className="sr-only">
        {t('nextActions.title')}
      </h2>
      {isGuestDone ? (
        // The day's last try: the limit card takes the buttons' place, and a
        // retry would be one more try, so it goes too (JLP-823).
        <GuestDailyLimitCard redirect="/" />
      ) : (
        /* Stacked full width under 640px, one row at text width above. */
        <div className="study-result-buttons flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {returnPath ? (
            <Link
              className={getButtonClassName({
                className: SAME_HEIGHT,
                size: 'lg'
              })}
              to={returnPath}
            >
              {t(setReturnLabelKey[returnPath])}
            </Link>
          ) : (
            <Button
              className={SAME_HEIGHT}
              size="lg"
              variant="primary"
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
              {guestTriesLeft === undefined ? null : (
                <ButtonTriesLeft remaining={guestTriesLeft} />
              )}
            </Button>
          )}
          {showRetry ? (
            <Button
              className={SAME_HEIGHT}
              size="lg"
              variant="outline"
              disabled={isRetryDisabled}
              isLoading={isRetryLoading}
              loadingLabel={retryLoadingLabel}
              onClick={onRetry}
            >
              {t('actions.retryIncorrect')}
            </Button>
          ) : null}
        </div>
      )}
      {/* A refused next set says why here, in place (G, #792 QA). */}
      <div className="mt-3" aria-live="polite">
        <PracticeSetupFeedback
          accountRestricted={nextSet.accountRestricted}
          hasCreateError={nextSet.hasCreateError}
          mode="RANDOM"
          noEligibleQuestions={nextSet.noEligibleQuestions}
          onSelectRandom={nextSet.start}
          sessionCap={nextSet.sessionCap}
        />
      </div>
    </section>
  )
}

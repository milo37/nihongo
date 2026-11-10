import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { GuestDailyLimitCard } from '@app/practice/components/GuestDailyLimitCard'
import { Button } from '@nihongo/browser/common/components/Button'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { useStartNextSet } from '@app/practice/result/useStartNextSet'
import { PracticeSetupFeedback } from '@app/practice/components/PracticeSetupFeedback'

// Outlined buttons add a border; fix both buttons at 48px (ux2 §2-4).
const SAME_HEIGHT = 'h-12'

type ResultActionsProps = {
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
 * 풀기] when something was wrong, then [다음 10문제]; both 48px. A member's
 * retry is filled; a guest's next set is, since each retry is one of the
 * day's tries (JLP-823).
 */
export const ResultActions = ({
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
        // The day's last try: the limit card takes the buttons' place, and a
        // retry would be one more try, so it goes too (JLP-823).
        <GuestDailyLimitCard redirect="/" />
      ) : (
        /* Stacked full width under 640px, one row at text width above. */
        <div className="study-result-buttons flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {showRetry ? (
            <Button
              className={SAME_HEIGHT}
              size="lg"
              variant={isGuest ? 'outline' : 'primary'}
              disabled={isRetryDisabled}
              isLoading={isRetryLoading}
              loadingLabel={retryLoadingLabel}
              onClick={onRetry}
            >
              {t('actions.retryIncorrect')}
            </Button>
          ) : null}
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
        />
      </div>
    </section>
  )
}

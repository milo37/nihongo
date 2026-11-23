import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import {
  ButtonTriesLeft,
  getGuestTriesLeft
} from '@app/practice/components/ButtonTriesLeft'
import { Button } from '@nihongo/browser/common/components/Button'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import type { PracticeSetupFormProps } from '@app/practice/components/PracticeSetupForm'

/** Live summary of the choice, the start button and the supply note. */
export const StartSummary = ({
  level,
  count,
  subjectLabel,
  startLabel,
  isReady,
  isGuest,
  isCreating,
  isGuestDailyLimitReached,
  guestAllowance
}: Pick<
  PracticeSetupFormProps,
  | 'level'
  | 'count'
  | 'subjectLabel'
  | 'startLabel'
  | 'isReady'
  | 'isGuest'
  | 'isCreating'
  | 'isGuestDailyLimitReached'
  | 'guestAllowance'
>): ReactElement | null => {
  const { i18n, t } = useTranslation('practice')
  const { t: homeT } = useTranslation('home')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  if (isGuestDailyLimitReached) return null
  const triesLeft = getGuestTriesLeft(isGuest, guestAllowance)
  return (
    <div className="practice-start-summary">
      <p className="sr-only" aria-live="polite">
        {level
          ? `${level} ${subjectLabel} · ${t('setup.questionCount', {
              formattedCount: formatNumber(count, locale)
            })}`
          : null}
      </p>
      <Button
        className="practice-start-button"
        // JLP-872: starting a new set is always the one filled button.
        variant="primary"
        fullWidth
        type="submit"
        aria-label={isCreating ? homeT('approved.loading') : undefined}
        disabled={!isReady}
        isLoading={isCreating}
        loadingLabel={homeT('approved.loading')}
        showLoadingIndicator={false}
        size="lg"
      >
        {startLabel}
        {triesLeft === undefined ? null : (
          <ButtonTriesLeft remaining={triesLeft} />
        )}
      </Button>
      {isGuest ? null : (
        <p className="practice-supply-note">{t('setup.availableCountNote')}</p>
      )}
    </div>
  )
}

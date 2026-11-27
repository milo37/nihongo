import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import type { usePracticeSetupController } from '@app/practice/hooks/usePracticeSetupController'
import {
  GUEST_DAILY_SESSION_LIMIT,
  GUEST_SESSION_QUESTION_LIMIT
} from '@nihongo/contracts/study/guest-limits'
import { GuestDailyLimitCard } from '@app/practice/components/GuestDailyLimitCard'
import { PracticeSetupFeedback } from '@app/practice/components/PracticeSetupFeedback'
import {
  ButtonTriesLeft,
  getGuestTriesLeft
} from '@app/practice/components/ButtonTriesLeft'
import { StartSentence } from '@app/home/components/StartSentence'

/**
 * 첫 화면 B (JLP-823): one sentence "오늘은 N5 문자·어휘 10문제 풀어 볼까요?"
 * whose level and subject are underlined pickers, one [시작하기], then quiet
 * lines (members: the unfinished set and what is left to review; guests:
 * today's tries). #991: no count strip; the sentence says the count.
 */
export const HeroStartCard = ({
  setup,
  memberLines
}: {
  setup: ReturnType<typeof usePracticeSetupController>
  memberLines?: ReactNode
}): ReactElement => {
  const { t } = useTranslation('home')
  const level = setup.level ?? setup.defaultLevel
  const { isGuest } = setup
  const guestTriesLeft = getGuestTriesLeft(isGuest, setup.guestAllowance)
  return (
    <div className="home-band-start">
      {/* #1041: on PC the title and button share the first row with today's
          question; the lines below start the second row. */}
      <div className="home-start-top">
        <StartSentence level={level} setup={setup} />
        {setup.isGuestDailyLimitReached ? (
          <div className="home-band-limit">
            <GuestDailyLimitCard redirect="/" />
          </div>
        ) : (
          <Button
            className="home-go"
            size="lg"
            disabled={!setup.isReady || !setup.level}
            isLoading={setup.isCreatingSession}
            loadingLabel={t('approved.loading')}
            onClick={setup.handleStart}
          >
            {isGuest ? t('today.startGuest') : t('today.startMember')}
            {guestTriesLeft === undefined ? null : (
              <ButtonTriesLeft remaining={guestTriesLeft} />
            )}
          </Button>
        )}
      </div>
      <div className="home-start-lines">
        {isGuest ? (
          // Only before the first try today; after it, the count sits in the
          // button (plan-notes §4).
          guestTriesLeft === undefined && !setup.isGuestDailyLimitReached ? (
            <p className="home-hello">
              {t('today.guestGreeting', {
                total: GUEST_DAILY_SESSION_LIMIT,
                count: GUEST_SESSION_QUESTION_LIMIT
              })}
            </p>
          ) : null
        ) : null}
        <PracticeSetupFeedback
          accountRestricted={setup.accountRestricted}
          hasCreateError={setup.hasCreateError}
          mode={setup.mode}
          noEligibleQuestions={setup.noEligibleQuestions}
          onSelectRandom={() => setup.changeSetting('mode', 'RANDOM', 'RANDOM')}
          sessionCap={setup.sessionCap}
        />
        {memberLines}
      </div>
    </div>
  )
}

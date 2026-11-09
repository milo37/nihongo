import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { usePracticeSetupController } from '@app/practice/hooks/usePracticeSetupController'
import { readLastPracticeChoice } from '@app/practice/lastPracticeChoice'
import { GuestDailyLimitCard } from '@app/practice/components/GuestDailyLimitCard'
import { PracticeSetupFeedback } from '@app/practice/components/PracticeSetupFeedback'

const subjectKeys = {
  VOCABULARY: 'subjects.vocabulary.label',
  GRAMMAR: 'subjects.grammar.label',
  READING: 'subjects.reading.label'
} as const

/**
 * The big start card: last level and subject (or N5 문자·어휘 the first
 * time), one filled button that starts a set, and a small [바꾸기] link to
 * the full setup (direction §1-2, subtract table 1).
 */
export const HeroStartCard = (): ReactElement => {
  const { t, i18n } = useTranslation('home')
  const resumableHeadingRef = useRef<HTMLHeadingElement>(null)
  const setup = usePracticeSetupController(resumableHeadingRef)
  const hasHistory = readLastPracticeChoice() !== null
  const { count, level, subject } = setup
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  return (
    <section className="home-hero" aria-labelledby="home-hero-title">
      <p className="text-[15px] font-semibold">
        {hasHistory ? t('today.lastStudy') : t('today.firstStudy')}
      </p>
      <h2 id="home-hero-title" className="home-hero-title">
        {t('today.startTitle', {
          level: level ?? setup.defaultLevel,
          subject: t(subjectKeys[subject])
        })}
      </h2>
      <p className="text-[15px]">
        {t('today.startMeta', {
          formattedCount: formatNumber(count, locale),
          minutes: formatNumber(Math.ceil(count / 2), locale)
        })}
      </p>
      {setup.isGuestDailyLimitReached ? (
        <div className="mt-5">
          <GuestDailyLimitCard redirect="/" />
        </div>
      ) : (
        <Button
          className="home-hero-start mt-6"
          size="lg"
          fullWidth
          disabled={!setup.isReady || !level}
          isLoading={setup.isCreatingSession}
          loadingLabel={t('approved.loading')}
          onClick={setup.handleStart}
        >
          {setup.isGuest ? t('today.startGuest') : t('today.startMember')}
        </Button>
      )}
      <PracticeSetupFeedback
        accountRestricted={setup.accountRestricted}
        hasCreateError={setup.hasCreateError}
        mode={setup.mode}
        noEligibleQuestions={setup.noEligibleQuestions}
        onSelectRandom={() => setup.changeSetting('mode', 'RANDOM', 'RANDOM')}
      />
      <Link
        className="home-hero-change"
        to="/practice"
        aria-label={t('today.changeLabel')}
      >
        {t('today.change')}
      </Link>
    </section>
  )
}

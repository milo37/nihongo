import { useTranslation } from 'react-i18next'
import type { ChangeEvent, ReactElement, ReactNode } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import type { usePracticeSetupController } from '@app/practice/hooks/usePracticeSetupController'
import { levels, subjects } from '@app/practice/practiceSetupOptions'
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

const LEVEL_SLOT = '[[level]]'
const SUBJECT_SLOT = '[[subject]]'
const BREAK_SLOT = '[[br]]'

const subjectKeys = {
  VOCABULARY: 'subjects.vocabulary.label',
  GRAMMAR: 'subjects.grammar.label',
  READING: 'subjects.reading.label'
} as const

/**
 * An underlined word in the sentence that opens a native picker. The select
 * sits invisibly on top of the word, so the word keeps its own width.
 */
const PickWord = ({
  label,
  value,
  options,
  onChange,
  disabled
}: {
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void
  disabled: boolean
}): ReactElement => (
  <span className="home-pick">
    <span className="home-pick-word" aria-hidden="true">
      {options.find((option) => option.value === value)?.label ?? value}
      <Icon name="chevron-right" className="home-pick-icon" />
    </span>
    <select
      className="home-pick-select"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={onChange}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </span>
)

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
  const { t, i18n } = useTranslation('home')
  const { count, subject } = setup
  const level = setup.level ?? setup.defaultLevel
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const { isGuest } = setup
  const guestTriesLeft = getGuestTriesLeft(isGuest, setup.guestAllowance)
  const pickDisabled = !setup.isReady || setup.isCreatingSession
  // The pickers go where {{level}} and {{subject}} are and the line breaks
  // before the count, after any particle (no Trans: it would add an HTML
  // parser to the bundle).
  // A guest who used up today's tries is asked about tomorrow (E7).
  const promptKey = setup.isGuestDailyLimitReached
    ? 'today.promptLimit'
    : 'today.prompt'
  const sentence = t(promptKey, {
    level: LEVEL_SLOT,
    subject: SUBJECT_SLOT,
    formattedCount: BREAK_SLOT + formatNumber(count, locale)
  }).split(/(\[\[level\]\]|\[\[subject\]\]|\[\[br\]\])/u)
  return (
    <div className="home-band-start">
      {/* #1041: on PC the title and button share the first row with today's
          question; the lines below start the second row. */}
      <div className="home-start-top">
        <h1
          className={
            setup.isGuestDailyLimitReached
              ? 'home-say home-say-limit'
              : 'home-say'
          }
          tabIndex={-1}
        >
          {sentence.map((part, index) =>
            part === LEVEL_SLOT ? (
              <PickWord
                key={index}
                label={t('today.pickLevel')}
                value={level}
                disabled={pickDisabled}
                options={levels.map((value) => ({ value, label: value }))}
                onChange={(event) =>
                  setup.changeSetting(
                    'level',
                    event.currentTarget.value,
                    setup.defaultLevel
                  )
                }
              />
            ) : part === SUBJECT_SLOT ? (
              <PickWord
                key={index}
                label={t('today.pickSubject')}
                value={subject}
                disabled={pickDisabled}
                options={subjects.map((value) => ({
                  value,
                  label: t(subjectKeys[value])
                }))}
                onChange={(event) =>
                  setup.changeSetting(
                    'subject',
                    event.currentTarget.value,
                    setup.defaultSubject
                  )
                }
              />
            ) : part === BREAK_SLOT ? (
              <br key={index} />
            ) : (
              part
            )
          )}
        </h1>
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

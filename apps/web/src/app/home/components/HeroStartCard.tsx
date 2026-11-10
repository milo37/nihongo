import { useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ChangeEvent, ReactElement, ReactNode } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { usePracticeSetupController } from '@app/practice/hooks/usePracticeSetupController'
import { levels, subjects } from '@app/practice/practiceSetupOptions'
import { GuestDailyLimitCard } from '@app/practice/components/GuestDailyLimitCard'
import { PracticeSetupFeedback } from '@app/practice/components/PracticeSetupFeedback'

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
 * whose level and subject are underlined pickers, one [바로 풀기], then one
 * quiet line (members: what is left to review; guests: log in to keep).
 */
export const HeroStartCard = ({
  memberLine
}: {
  memberLine?: ReactNode
}): ReactElement => {
  const { t, i18n } = useTranslation('home')
  const { t: commonT } = useTranslation('common')
  const { user } = useAuth()
  const resumableHeadingRef = useRef<HTMLHeadingElement>(null)
  const setup = usePracticeSetupController(resumableHeadingRef)
  const { count, subject } = setup
  const level = setup.level ?? setup.defaultLevel
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const { isGuest } = setup
  const pickDisabled = !setup.isReady || setup.isCreatingSession
  return (
    <div className="home-band-start">
      <p className="home-hello">
        {isGuest
          ? t('today.guestGreeting')
          : user?.name
            ? t('today.memberGreeting', { name: user.name })
            : t('today.memberGreetingNoName')}
      </p>
      <h1 className="home-say" tabIndex={-1}>
        <Trans
          t={t}
          i18nKey="today.say"
          values={{ formattedCount: formatNumber(count, locale) }}
          components={{
            level: (
              <PickWord
                label={t('today.levelLabel')}
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
            ),
            subject: (
              <PickWord
                label={t('today.subjectLabel')}
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
            ),
            br: <br />
          }}
        />
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
          {t('today.startMember')}
          <Icon name="arrow-right" className="size-5" />
        </Button>
      )}
      <PracticeSetupFeedback
        accountRestricted={setup.accountRestricted}
        hasCreateError={setup.hasCreateError}
        mode={setup.mode}
        noEligibleQuestions={setup.noEligibleQuestions}
        onSelectRandom={() => setup.changeSetting('mode', 'RANDOM', 'RANDOM')}
      />
      {isGuest ? (
        <p className="home-more">
          <Icon name="bookmark" className="home-more-icon" />
          {t('today.keepLogin')}
          <Link to={setup.loginHref}>
            {commonT('actions.login')}
            <Icon name="chevron-right" className="size-4" />
          </Link>
        </p>
      ) : setup.isReady ? (
        memberLine
      ) : null}
    </div>
  )
}

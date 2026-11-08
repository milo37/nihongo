import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { ChoiceRadioGroup } from '@common/components/ChoiceRadioGroup'
import { Select } from '@nihongo/browser/common/components/Select'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type {
  JlptLevel,
  QuestionSubject,
  StudyMode
} from '@nihongo/browser/common/types/domain'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { GUEST_SESSION_QUESTION_LIMIT } from '@nihongo/contracts/study/guest-limits'

// Renders the <b>…</b> marks in a translated line as bold text.
export const withBold = (text: string): ReactNode[] =>
  text
    .split(/(<b>.*?<\/b>)/u)
    .map((part, index) =>
      part.startsWith('<b>') ? <b key={index}>{part.slice(3, -4)}</b> : part
    )

type PracticeSetupFormProps = {
  level: JlptLevel
  subject: QuestionSubject
  count: 5 | 10 | 20
  mode: StudyMode
  levels: readonly JlptLevel[]
  subjects: readonly QuestionSubject[]
  counts: readonly number[]
  modes: readonly StudyMode[]
  isReady: boolean
  isGuest: boolean
  isCreating: boolean
  /** Guest who used today's tries: no start button (L18 card shows above). */
  isGuestDailyLimitReached: boolean
  guestAllowance: { remaining: number; dailyLimit: number } | null
  hasResumableSession: boolean
  subjectLabel: string
  startLabel: string
  feedback: ReactNode
  onLevelChange: (level: JlptLevel) => void
  onSubjectChange: (subject: QuestionSubject) => void
  onCountChange: (count: number) => void
  onModeChange: (mode: StudyMode) => void
  onStart: () => void
}

const subjectIcons = {
  VOCABULARY: 'languages',
  GRAMMAR: 'text-cursor-input',
  READING: 'book-open'
} as const

/** Subject picker with an icon per subject. */
const SubjectChoice = ({
  subject,
  subjects,
  disabled,
  onSubjectChange
}: Pick<PracticeSetupFormProps, 'subject' | 'subjects' | 'onSubjectChange'> & {
  disabled: boolean
}): ReactElement => {
  const { t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const { t: homeT } = useTranslation('home')
  return (
    <ChoiceRadioGroup
      className="choice-subjects"
      appearance="segmented"
      name="practice-subject"
      legend={t('setup.steps.subject')}
      value={subject}
      disabled={disabled}
      options={subjects.map((value) => ({
        value,
        label: (
          <>
            <Icon className="size-5" name={subjectIcons[value]} />
            {value === 'VOCABULARY'
              ? homeT('approved.vocabulary')
              : commonT(`taxonomy.subjects.${value}`)}
          </>
        )
      }))}
      onValueChange={onSubjectChange}
    />
  )
}

/** Live summary of the choice, the start button and the supply note. */
const StartSummary = ({
  level,
  count,
  subjectLabel,
  startLabel,
  isReady,
  isGuest,
  isCreating,
  isGuestDailyLimitReached,
  guestAllowance,
  hasResumableSession
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
  | 'hasResumableSession'
>): ReactElement | null => {
  const { i18n, t } = useTranslation('practice')
  const { t: homeT } = useTranslation('home')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  if (isGuestDailyLimitReached) return null
  return (
    <div className="practice-start-summary">
      <p className="sr-only" aria-live="polite">
        {level} {subjectLabel} ·{' '}
        {t('setup.questionCount', {
          formattedCount: formatNumber(count, locale)
        })}
      </p>
      <Button
        className="practice-start-button"
        variant={hasResumableSession ? 'outline' : 'primary'}
        fullWidth
        type="submit"
        aria-label={isCreating ? homeT('approved.loading') : startLabel}
        disabled={!isReady}
        isLoading={isCreating}
        loadingLabel={homeT('approved.loading')}
        showLoadingIndicator={false}
        size="lg"
      >
        {startLabel}
      </Button>
      {isGuest ? (
        guestAllowance ? (
          <p className="practice-supply-note">
            {withBold(
              t('setup.guestLeft', {
                total: formatNumber(guestAllowance.dailyLimit, locale),
                remaining: formatNumber(guestAllowance.remaining, locale)
              })
            )}
          </p>
        ) : null
      ) : (
        <p className="practice-supply-note">{t('setup.availableCountNote')}</p>
      )}
    </div>
  )
}

/**
 * Collapsible mode picker. For a guest every mode but RANDOM is marked
 * locked yet still choosable: choosing one explains why and keeps RANDOM.
 */
const ModeOptions = ({
  mode,
  modes,
  isReady,
  isGuest,
  isCreating,
  onModeChange
}: Pick<
  PracticeSetupFormProps,
  'mode' | 'modes' | 'isReady' | 'isGuest' | 'isCreating' | 'onModeChange'
>): ReactElement => {
  const { t } = useTranslation('practice')
  return (
    <details
      className="practice-mode-options"
      open={mode !== 'RANDOM' || undefined}
    >
      <summary>{t('setup.modeSummary')}</summary>
      <div className="practice-mode-field">
        <Select
          className="practice-mode-select"
          name="practice-mode"
          label={t('setup.steps.mode')}
          value={mode}
          disabled={!isReady || isCreating}
          aria-describedby="practice-mode-description"
          onChange={(event) => {
            const option = modes.find(
              (item) => item === event.currentTarget.value
            )
            if (option) onModeChange(option)
          }}
        >
          {modes.map((value) => (
            <option key={value} value={value}>
              {isGuest && value !== 'RANDOM'
                ? `${t(`setup.modes.${value}.label`)} 🔒 ${t('setup.memberLocked')}`
                : t(`setup.modes.${value}.label`)}
            </option>
          ))}
        </Select>
        <p className="practice-field-detail" id="practice-mode-description">
          {t(`setup.modes.${mode}.description`)}
        </p>
      </div>
    </details>
  )
}

export const PracticeSetupForm = ({
  level,
  subject,
  count,
  mode,
  levels,
  subjects,
  counts,
  modes,
  isReady,
  isGuest,
  isCreating,
  isGuestDailyLimitReached,
  guestAllowance,
  hasResumableSession,
  subjectLabel,
  startLabel,
  feedback,
  onLevelChange,
  onSubjectChange,
  onCountChange,
  onModeChange,
  onStart
}: PracticeSetupFormProps): ReactElement => {
  const { i18n, t } = useTranslation('practice')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)

  return (
    <form
      className="practice-selection"
      aria-labelledby="practice-start-title"
      onSubmit={(event) => {
        event.preventDefault()
        onStart()
      }}
    >
      <h2 id="practice-start-title">
        {t(hasResumableSession ? 'setup.newTitle' : 'setup.formTitle')}
      </h2>
      <SubjectChoice
        subject={subject}
        subjects={subjects}
        disabled={isCreating}
        onSubjectChange={onSubjectChange}
      />
      <div className="practice-settings">
        <ChoiceRadioGroup
          appearance="segmented"
          className="choice-levels"
          name="practice-level"
          legend={t('setup.steps.level')}
          value={level}
          disabled={isCreating}
          options={levels.map((value) => ({ value, label: value }))}
          onValueChange={onLevelChange}
        />
        <ChoiceRadioGroup
          appearance="segmented"
          name="practice-count"
          legend={t('setup.steps.count')}
          value={String(count)}
          disabled={isCreating}
          options={counts.map((value) => ({
            value: String(value),
            label:
              isGuest && value !== GUEST_SESSION_QUESTION_LIMIT ? (
                <>
                  {t('setup.questionCount', {
                    formattedCount: formatCount(value)
                  })}
                  <span aria-hidden="true">🔒</span>
                  <span className="sr-only">{t('setup.memberLocked')}</span>
                </>
              ) : (
                t('setup.questionCount', {
                  formattedCount: formatCount(value)
                })
              )
          }))}
          onValueChange={(value) => onCountChange(Number(value))}
        />
      </div>

      {feedback ? (
        <div className="practice-setup-feedback">{feedback}</div>
      ) : null}

      <StartSummary
        level={level}
        count={count}
        subjectLabel={subjectLabel}
        startLabel={startLabel}
        isReady={isReady}
        isGuest={isGuest}
        isCreating={isCreating}
        isGuestDailyLimitReached={isGuestDailyLimitReached}
        guestAllowance={guestAllowance}
        hasResumableSession={hasResumableSession}
      />
      <ModeOptions
        mode={mode}
        modes={modes}
        isReady={isReady}
        isGuest={isGuest}
        isCreating={isCreating}
        onModeChange={onModeChange}
      />
    </form>
  )
}

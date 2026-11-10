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

// Renders the <b>…</b> marks in a translated line as bold text.
type PracticeSetupFormProps = {
  /** Null until the default level is known. */
  level: JlptLevel | null
  subject: QuestionSubject
  count: number
  mode: StudyMode
  levels: readonly JlptLevel[]
  subjects: readonly QuestionSubject[]
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
        {level
          ? `${level} ${subjectLabel} · ${t('setup.questionCount', {
              formattedCount: formatNumber(count, locale)
            })}`
          : null}
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
        // Only after a first try: a fresh guest reads the rule up top.
        guestAllowance &&
        guestAllowance.remaining < guestAllowance.dailyLimit ? (
          <p className="practice-supply-note">
            {t('setup.guestLeft', {
              remaining: formatNumber(guestAllowance.remaining, locale)
            })}
          </p>
        ) : null
      ) : (
        <p className="practice-supply-note">{t('setup.availableCountNote')}</p>
      )}
    </div>
  )
}

/**
 * Collapsible mode picker, members only: every mode but RANDOM reads the
 * member's wrong notes, so a guest has nothing to pick (JLP-823, no locks).
 */
const ModeOptions = ({
  mode,
  modes,
  isReady,
  isCreating,
  onModeChange
}: Pick<
  PracticeSetupFormProps,
  'mode' | 'modes' | 'isReady' | 'isCreating' | 'onModeChange'
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
              {t(`setup.modes.${value}.label`)}
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
  onModeChange,
  onStart
}: PracticeSetupFormProps): ReactElement => {
  const { t } = useTranslation('practice')

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
      {isGuest ? null : (
        <ModeOptions
          mode={mode}
          modes={modes}
          isReady={isReady}
          isCreating={isCreating}
          onModeChange={onModeChange}
        />
      )}
    </form>
  )
}

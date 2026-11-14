import { useTranslation } from 'react-i18next'
import {
  ButtonTriesLeft,
  getGuestTriesLeft
} from '@app/practice/components/ButtonTriesLeft'
import type { ReactElement, ReactNode } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { ChoiceRadioGroup } from '@common/components/ChoiceRadioGroup'
import { Select } from '@nihongo/browser/common/components/Select'
import type {
  JlptLevel,
  QuestionSubject,
  StudyMode
} from '@nihongo/browser/common/types/domain'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { MEMBER_COUNT_CHOICES } from '@app/practice/practiceSetupOptions'

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
  onCountChange: (count: number) => void
  onStart: () => void
}

/** One kanji per subject in a square (B4 §4); the name follows in text. */
const subjectGlyphs = {
  VOCABULARY: '字',
  GRAMMAR: '文',
  READING: '読'
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
            <span className="subject-glyph" lang="ja" aria-hidden="true">
              {subjectGlyphs[value]}
            </span>
            <span className="subject-text">
              <span>
                {value === 'VOCABULARY'
                  ? homeT('approved.vocabulary')
                  : commonT(`taxonomy.subjects.${value}`)}
              </span>
              <span className="subject-description">
                {homeT(subjectDescriptionKeys[value])}
              </span>
            </span>
          </>
        )
      }))}
      onValueChange={onSubjectChange}
    />
  )
}

// One line under each subject (plan-notes §5).
const subjectDescriptionKeys = {
  VOCABULARY: 'subjects.vocabulary.description',
  GRAMMAR: 'subjects.grammar.description',
  READING: 'subjects.reading.description'
} as const

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
  onCountChange,
  onStart
}: PracticeSetupFormProps): ReactElement => {
  const { t, i18n } = useTranslation('practice')
  const locale = resolveUiLocale(i18n.resolvedLanguage)

  return (
    <form
      className="practice-selection"
      // The page h1 already asks "무엇을 풀까요?"; a second heading only
      // when a resumable set sits above (plan-notes §5).
      aria-labelledby={hasResumableSession ? 'practice-start-title' : undefined}
      aria-label={hasResumableSession ? undefined : t('setup.formTitle')}
      onSubmit={(event) => {
        event.preventDefault()
        onStart()
      }}
    >
      {hasResumableSession ? (
        <h2 id="practice-start-title">{t('setup.newTitle')}</h2>
      ) : null}
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
      {/* Members pick the set size; guests always get the guest set. */}
      {isGuest ? null : (
        <ChoiceRadioGroup
          appearance="segmented"
          className="choice-counts"
          name="practice-count"
          legend={t('setup.steps.count')}
          value={String(count)}
          disabled={isCreating}
          options={MEMBER_COUNT_CHOICES.map((value) => ({
            value: String(value),
            label: t('setup.questionCount', {
              formattedCount: formatNumber(value, locale)
            })
          }))}
          onValueChange={(value) => onCountChange(Number(value))}
        />
      )}

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

import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { ChoiceRadioGroup } from '@common/components/ChoiceRadioGroup'
import type {
  JlptLevel,
  QuestionSubject,
  StudyMode
} from '@nihongo/browser/common/types/domain'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { MEMBER_COUNT_CHOICES } from '@app/practice/practiceSetupOptions'
import {
  ModeOptions,
  SubjectChoice
} from '@app/practice/components/PracticeSetupChoices'
import { StartSummary } from '@app/practice/components/PracticeStartSummary'

// Renders the <b>…</b> marks in a translated line as bold text.
export type PracticeSetupFormProps = {
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

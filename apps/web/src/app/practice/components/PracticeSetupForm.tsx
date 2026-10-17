import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import { Button } from '@common/components/Button'
import { ChoiceRadioGroup } from '@common/components/ChoiceRadioGroup'
import { Select } from '@common/components/Select'
import { Icon } from '@common/components/Icon'
import type {
  JlptLevel,
  QuestionSubject,
  StudyMode
} from '@common/types/domain'
import { formatNumber } from '@libs/localeFormatters'
import { resolveUiLocale } from '@/i18n/types'

type PracticeSetupFormProps = {
  level: JlptLevel
  subject: QuestionSubject
  count: 5 | 10 | 20
  mode: StudyMode
  levels: readonly JlptLevel[]
  subjects: readonly QuestionSubject[]
  counts: readonly number[]
  modes: readonly { value: StudyMode; requiresLogin: boolean }[]
  isReady: boolean
  isGuest: boolean
  isCreating: boolean
  isProtectedGuestMode: boolean
  hasResumableSession: boolean
  subjectLabel: string
  startLabel: string
  loginHref: string
  feedback: ReactNode
  onLevelChange: (level: JlptLevel) => void
  onSubjectChange: (subject: QuestionSubject) => void
  onCountChange: (count: number) => void
  onModeChange: (mode: StudyMode) => void
  onStart: () => void
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
  isProtectedGuestMode,
  hasResumableSession,
  subjectLabel,
  startLabel,
  loginHref,
  feedback,
  onLevelChange,
  onSubjectChange,
  onCountChange,
  onModeChange,
  onStart
}: PracticeSetupFormProps): ReactElement => {
  const { i18n, t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const { t: homeT } = useTranslation('home')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const subjectIcons = {
    VOCABULARY: 'languages',
    GRAMMAR: 'text-cursor-input',
    READING: 'book-open'
  } as const

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
      <ChoiceRadioGroup
        className="choice-subjects"
        appearance="segmented"
        name="practice-subject"
        legend={t('setup.steps.subject')}
        value={subject}
        disabled={isCreating}
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
            label: t('setup.questionCount', {
              formattedCount: formatCount(value)
            })
          }))}
          onValueChange={(value) => onCountChange(Number(value))}
        />
      </div>

      {feedback ? (
        <div className="practice-setup-feedback">{feedback}</div>
      ) : null}

      <div className="practice-start-summary">
        <p className="sr-only" aria-live="polite">
          {level} {subjectLabel} ·{' '}
          {t('setup.questionCount', { formattedCount: formatCount(count) })}
        </p>
        <Button
          className="practice-start-button"
          variant={hasResumableSession ? 'outline' : 'primary'}
          fullWidth
          type="submit"
          aria-label={isCreating ? homeT('approved.loading') : startLabel}
          disabled={!isReady || isProtectedGuestMode}
          isLoading={isCreating}
          loadingLabel={homeT('approved.loading')}
          showLoadingIndicator={false}
          size="lg"
        >
          {startLabel}
        </Button>
        <p className="practice-supply-note">
          {isGuest ? t('setup.guestHint') : t('setup.availableCountNote')}
        </p>
      </div>
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
                (item) => item.value === event.currentTarget.value
              )
              if (option) onModeChange(option.value)
            }}
          >
            {modes
              .filter((option) => !option.requiresLogin)
              .map(({ value }) => (
                <option key={value} value={value}>
                  {t(`setup.modes.${value}.label`)}
                </option>
              ))}
            <optgroup label={t('setup.memberModes')}>
              {modes
                .filter((option) => option.requiresLogin)
                .map(({ value }) => (
                  <option key={value} value={value} disabled={isGuest}>
                    {t(`setup.modes.${value}.label`)}
                  </option>
                ))}
            </optgroup>
          </Select>
          <p className="practice-field-detail" id="practice-mode-description">
            {t(`setup.modes.${mode}.description`)}
          </p>
          {isGuest && !isProtectedGuestMode ? (
            <p className="practice-mode-login practice-field-detail">
              {t('setup.memberModesHint')}{' '}
              <Link to={loginHref}>{t('setup.login')}</Link>
            </p>
          ) : null}
        </div>
      </details>
    </form>
  )
}

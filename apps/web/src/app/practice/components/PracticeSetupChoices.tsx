import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { ChoiceRadioGroup } from '@common/components/ChoiceRadioGroup'
import { Select } from '@nihongo/browser/common/components/Select'
import type { PracticeSetupFormProps } from '@app/practice/components/PracticeSetupForm'

/** One kanji per subject in a square (B4 §4); the name follows in text. */
const subjectGlyphs = {
  VOCABULARY: '字',
  GRAMMAR: '文',
  READING: '読'
} as const

/** Subject picker with an icon per subject. */
export const SubjectChoice = ({
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

/**
 * Collapsible mode picker, members only: every mode but RANDOM reads the
 * member's wrong notes, so a guest has nothing to pick (JLP-823, no locks).
 */
export const ModeOptions = ({
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

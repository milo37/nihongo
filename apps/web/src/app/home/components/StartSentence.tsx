import { useTranslation } from 'react-i18next'
import type { ChangeEvent, ReactElement } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import type { usePracticeSetupController } from '@app/practice/hooks/usePracticeSetupController'
import { levels, subjects } from '@app/practice/practiceSetupOptions'

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

/** The opening question; its level and subject are the pickers. */
export const StartSentence = ({
  level,
  setup
}: {
  level: string
  setup: ReturnType<typeof usePracticeSetupController>
}): ReactElement => {
  // Left uncompiled: the compiled parent already caches this section, and
  // compiling it too adds about 200 bytes gzip (#1124 bundle).
  'use no memo'
  const { t, i18n } = useTranslation('home')
  const { count, subject } = setup
  const locale = resolveUiLocale(i18n.resolvedLanguage)
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
    <h1
      className={
        setup.isGuestDailyLimitReached ? 'home-say home-say-limit' : 'home-say'
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
  )
}

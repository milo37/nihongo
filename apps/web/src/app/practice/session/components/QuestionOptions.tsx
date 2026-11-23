import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { RadioGroup } from '@nihongo/browser/common/components/RadioGroup'
import type { StudyQuestionView } from '@app/practice/adapters/studySessionView'
import { JaText } from '@common/components/JaText'
import { jaTextProps } from '@common/libs/jaSpacing'

/** The answer choices: a radio group whose labels carry the option number. */
export const QuestionOptions = ({
  question,
  isOptionsDisabled,
  selectedOptionId,
  onSelectOption
}: {
  question: StudyQuestionView
  isOptionsDisabled: boolean
  selectedOptionId: string | undefined
  onSelectOption: (optionId: string) => void
}): ReactElement => {
  const { t } = useTranslation('practice')
  return (
    <RadioGroup
      // Whole option is the target: radio hidden, number circle filled when
      // chosen (direction §6-3). session.css hides the radio with !important
      // to beat its unlayered input rule.
      className="study-answer-options"
      disabled={isOptionsDisabled}
      name={`question-${question.id}`}
      legend={t('session.question.answerLegend')}
      value={selectedOptionId ?? ''}
      options={question.options.map((option) => ({
        value: option.id,
        label: (
          <span className="study-option-label">
            <span aria-hidden="true" className="study-option-number">
              {option.label}
            </span>
            <span className="study-option-text" {...jaTextProps(option.text)}>
              <span className="sr-only">{option.label}. </span>
              <JaText text={option.text} />
            </span>
          </span>
        )
      }))}
      onValueChange={onSelectOption}
    />
  )
}

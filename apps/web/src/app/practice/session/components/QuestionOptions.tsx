import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { RadioGroup } from '@nihongo/browser/common/components/RadioGroup'
import type { StudyQuestionView } from '@app/practice/adapters/studySessionView'
import { JaText } from '@common/components/JaText'
import { jaTextProps } from '@common/libs/jaSpacing'

// Whole option is the target: radio hidden, number circle filled when chosen (direction §6-3).
// Reuses the shipped .study-answer-options look; `!` beats its unlayered input rule.
const OPTION_GROUP_CLASS =
  'study-answer-options [&_legend]:sr-only [&_input]:absolute! [&_input]:opacity-0! [&_label]:items-center'

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
      className={OPTION_GROUP_CLASS}
      disabled={isOptionsDisabled}
      name={`question-${question.id}`}
      legend={t('session.question.answerLegend')}
      value={selectedOptionId ?? ''}
      options={question.options.map((option) => ({
        value: option.id,
        label: (
          <span className="flex items-center gap-3 font-normal">
            <span
              aria-hidden="true"
              className="study-option-number grid size-7.5 shrink-0 place-items-center text-sm font-bold"
            >
              {option.label}
            </span>
            <span
              className="study-option-text min-w-0 leading-[1.6]"
              {...jaTextProps(option.text)}
            >
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

import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { RadioGroup } from '@nihongo/browser/common/components/RadioGroup'
import type { StudyQuestionView } from '@app/practice/adapters/studySessionView'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'

type PracticeQuestionCardProps = {
  bookmarkButton: ReactNode
  bookmarkStatus: ReactNode
  elapsedSeconds: number
  headingRef: RefObject<HTMLHeadingElement | null>
  isOptionsDisabled: boolean
  onSelectOption: (optionId: string) => void
  question: StudyQuestionView
  questionNumber: number
  saveStatus: ReactNode
  selectedOptionId: string | undefined
}

/** Reading passage, scrollable beside the question on wide screens. */
const QuestionPassage = ({ passage }: { passage: string }): ReactElement => {
  const { t } = useTranslation('practice')
  return (
    <article
      aria-label={t('session.question.passageLabel')}
      className="scroll-mt-24 border-b border-line bg-surface-muted p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand sm:p-7 lg:max-h-[680px] lg:overflow-y-auto lg:border-b-0 lg:border-r"
      tabIndex={0}
    >
      <p className="text-xs font-black tracking-[0.14em] text-brand">
        {t('session.question.passageEyebrow')}
      </p>
      <p className="sr-only">{t('session.question.passageLabel')}</p>
      <p
        className="mt-5 whitespace-pre-line text-base leading-8 text-ink"
        lang="ja"
      >
        {passage}
      </p>
    </article>
  )
}

/** Collapsible keyboard hints with the elapsed time. */
const KeyboardHelp = ({
  elapsedSeconds
}: {
  elapsedSeconds: number
}): ReactElement => {
  const { t } = useTranslation('practice')
  const { formatDuration } = usePracticeNumberFormat()
  return (
    <details className="study-keyboard-help mt-4 text-sm leading-6 text-muted">
      <summary className="note-link cursor-pointer">
        {t('session.keyboardHelp')}
      </summary>
      <p className="mb-2">
        {t('session.header.elapsedTime')}{' '}
        <span className="font-mono tabular-nums">
          {formatDuration(elapsedSeconds)}
        </span>
      </p>
      <p>{t('session.question.keyboardHint')}</p>
    </details>
  )
}

export const PracticeQuestionCard = ({
  bookmarkButton,
  bookmarkStatus,
  elapsedSeconds,
  headingRef,
  isOptionsDisabled,
  onSelectOption,
  question,
  questionNumber,
  saveStatus,
  selectedOptionId
}: PracticeQuestionCardProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { formatCount } = usePracticeNumberFormat()

  return (
    <div
      className={[
        'study-question mt-4 border-line',
        question.subject === 'READING'
          ? 'lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]'
          : ''
      ].join(' ')}
    >
      {question.passage ? <QuestionPassage passage={question.passage} /> : null}

      <article className="study-question-content min-w-0 py-4 sm:py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {question.tags.map((tag) => (
              <span key={tag} className="text-sm text-muted">
                {tag}
              </span>
            ))}
          </div>
          {bookmarkButton}
        </div>
        {bookmarkStatus}

        <h1
          ref={headingRef}
          className="mt-4 rounded-sm text-2xl font-semibold leading-[1.7]"
          tabIndex={-1}
        >
          <span className="mb-2 block text-sm font-medium text-muted">
            {t('session.question.numberLabel', {
              ordinal: formatCount(questionNumber)
            })}{' '}
          </span>
          <span lang="ja">{question.questionText}</span>
        </h1>

        <div className="mt-4">
          <RadioGroup
            className="learning-options study-answer-options"
            disabled={isOptionsDisabled}
            name={`question-${question.id}`}
            legend={t('session.question.answerLegend')}
            value={selectedOptionId ?? ''}
            options={question.options.map((option) => ({
              value: option.id,
              label: (
                <span className="study-answer-label">
                  <span lang="ja">
                    {option.label}. {option.text}
                  </span>
                  {selectedOptionId === option.id ? (
                    <Icon className="size-5 shrink-0" name="check" />
                  ) : null}
                </span>
              )
            }))}
            onValueChange={onSelectOption}
          />
        </div>
        {saveStatus}
        <KeyboardHelp elapsedSeconds={elapsedSeconds} />
      </article>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { RadioGroup } from '@nihongo/browser/common/components/RadioGroup'
import type { StudyQuestionView } from '@app/practice/adapters/studySessionView'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'

type PracticeQuestionCardProps = {
  actions: ReactNode
  bookmarkStatus: ReactNode
  headingRef: RefObject<HTMLHeadingElement | null>
  isOptionsDisabled: boolean
  onSelectOption: (optionId: string) => void
  question: StudyQuestionView
  questionNumber: number
  saveStatus: ReactNode
  selectedOptionId: string | undefined
}

// Whole option is the target: radio hidden, number circle filled when chosen (direction §6-3).
// Reuses the shipped .study-answer-options look; `!` beats its unlayered input rule.
const OPTION_GROUP_CLASS =
  'study-answer-options [&_legend]:sr-only [&_input]:absolute! [&_input]:opacity-0! [&_label]:items-center'

/** Passage card: as tall as its text; sticky beside the question on wide screens. */
const QuestionPassage = ({
  passage,
  passageRef
}: {
  passage: string
  passageRef: RefObject<HTMLElement | null>
}): ReactElement => {
  const { t } = useTranslation('practice')
  return (
    <article
      ref={passageRef}
      aria-label={t('session.question.passageLabel')}
      className="scroll-mt-4 rounded-card border border-line bg-surface px-5 py-[22px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand lg:sticky lg:top-6 lg:max-h-[calc(100vh-140px)] lg:overflow-y-auto lg:px-9 lg:py-8"
      tabIndex={0}
    >
      <p className="mb-3 text-[13px] font-bold text-muted">
        {t('session.question.passageLabel')}
      </p>
      <p
        className="whitespace-pre-line text-[17px] leading-[1.9] lg:text-[18px] tracking-[0.02em] text-ink"
        lang="ja"
      >
        {passage}
      </p>
    </article>
  )
}

/** True once the passage has scrolled fully out of view (one-column layout). */
const usePassageOutOfView = (
  passageRef: RefObject<HTMLElement | null>,
  hasPassage: boolean
): boolean => {
  const [isOut, setOut] = useState(false)
  useEffect(() => {
    const passage = passageRef.current
    if (!hasPassage || !passage || typeof IntersectionObserver === 'undefined')
      return
    const observer = new IntersectionObserver(([entry]) => {
      setOut(entry ? !entry.isIntersecting : false)
    })
    observer.observe(passage)
    return () => {
      observer.disconnect()
      setOut(false)
    }
  }, [hasPassage, passageRef])
  return isOut
}

export const PracticeQuestionCard = ({
  actions,
  bookmarkStatus,
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
  const passageRef = useRef<HTMLElement>(null)
  const isPassageOut = usePassageOutOfView(
    passageRef,
    Boolean(question.passage)
  )

  const showPassage = (): void => {
    const reduceMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches
    passageRef.current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start'
    })
    passageRef.current?.focus({ preventScroll: true })
  }

  return (
    <div
      className={
        question.passage
          ? 'grid items-start gap-8 lg:grid-cols-2 lg:gap-12'
          : undefined
      }
    >
      {question.passage ? (
        <QuestionPassage passage={question.passage} passageRef={passageRef} />
      ) : null}

      {/* Tags can name the answer, so they appear only after submission. */}
      <article className="min-w-0">
        {bookmarkStatus}

        <div className="flex items-start justify-between gap-3">
          <h1
            ref={headingRef}
            className="min-w-0 rounded-sm [text-wrap:wrap]"
            tabIndex={-1}
          >
            <span className="mb-2 block text-[13px] font-bold text-brand">
              {t('session.question.numberLabel', {
                ordinal: formatCount(questionNumber)
              })}{' '}
            </span>
            <span className="study-question-text block font-bold" lang="ja">
              {question.questionText}
            </span>
          </h1>
          {isPassageOut ? (
            <button
              className="note-link min-h-11 shrink-0 gap-1 text-[13px]"
              type="button"
              onClick={showPassage}
            >
              <Icon className="size-4 rotate-90" name="chevron-left" />
              {t('session.question.passageLabel')}
            </button>
          ) : null}
        </div>

        <div className="mt-5 lg:mt-6">
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
                    lang="ja"
                  >
                    <span className="sr-only">{option.label}. </span>
                    {option.text}
                  </span>
                </span>
              )
            }))}
            onValueChange={onSelectOption}
          />
        </div>
        {saveStatus}
        {actions}
      </article>
    </div>
  )
}

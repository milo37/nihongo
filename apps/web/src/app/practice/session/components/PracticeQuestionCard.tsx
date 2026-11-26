import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { StudyQuestionView } from '@app/practice/adapters/studySessionView'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'
import { usePassageOutOfView } from '@app/practice/session/usePassageOutOfView'
import { QuestionOptions } from '@app/practice/session/components/QuestionOptions'
import { QuestionPassage } from '@app/practice/session/components/QuestionPassage'
import { JaText } from '@common/components/JaText'
import { jaTextProps } from '@common/libs/jaSpacing'

/** JLP-870 push: which way this card's blocks slide, in or out. */
export type QuestionPush = 'in-next' | 'in-prev' | 'out-next' | 'out-prev'

type PracticeQuestionCardProps = {
  actions: ReactNode
  headingRef: RefObject<HTMLHeadingElement | null>
  isOptionsDisabled: boolean
  /**
   * JLP-870: the copy pushed out. No heading, passage landmark or passage
   * button, so the document keeps one h1 and one article while it slides.
   */
  isDecorative?: boolean
  onSelectOption: (optionId: string) => void
  /** Slide the passage and question blocks; the action bar never moves. */
  push?: QuestionPush | undefined
  question: StudyQuestionView
  questionNumber: number
  saveStatus: ReactNode
  selectedOptionId: string | undefined
}

const HEADING_CLASS = 'study-question-heading'

export const PracticeQuestionCard = ({
  actions,
  headingRef,
  isOptionsDisabled,
  isDecorative = false,
  onSelectOption,
  push,
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
    Boolean(question.passage) && !isDecorative
  )

  const headingContent = (
    <>
      <span className="study-question-number">
        {t('session.question.numberLabel', {
          ordinal: formatCount(questionNumber)
        })}{' '}
      </span>
      <span
        className="study-question-text"
        {...jaTextProps(question.questionText)}
      >
        <JaText text={question.questionText} />
      </span>
    </>
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
    <div className={question.passage ? 'study-question-grid' : undefined}>
      {question.passage ? (
        <QuestionPassage
          key={question.id}
          furigana={question.passageFurigana}
          isDecorative={isDecorative}
          isSamePassage={Boolean(question.isSamePassageAsPrevious)}
          passage={question.passage}
          passageAudio={question.passageAudio ?? null}
          passageRef={passageRef}
          push={push}
        />
      ) : null}

      {/* Tags can name the answer, so they appear only after submission. */}
      <article className="study-question-main">
        {/* The action bar stays outside: it is fixed on phones, and a
            transform on its ancestor would carry it along (JLP-870). */}
        <div className="study-push" data-push={push}>
          <div className="study-question-head">
            {isDecorative ? (
              <div className={HEADING_CLASS}>{headingContent}</div>
            ) : (
              <h1 ref={headingRef} className={HEADING_CLASS} tabIndex={-1}>
                {headingContent}
              </h1>
            )}
            {isPassageOut ? (
              <button
                className="note-link study-passage-back"
                type="button"
                onClick={showPassage}
              >
                <Icon className="study-passage-back-icon" name="chevron-left" />
                {t('session.question.passageLabel')}
              </button>
            ) : null}
          </div>

          <div className="study-question-options">
            <QuestionOptions
              question={question}
              isOptionsDisabled={isOptionsDisabled}
              selectedOptionId={selectedOptionId}
              onSelectOption={onSelectOption}
            />
          </div>
          {saveStatus}
        </div>
        {actions}
      </article>
    </div>
  )
}

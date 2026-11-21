import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { ExplanationLanguagePanel } from '@common/components/ExplanationLanguagePanel'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import type { WrongNotePreviousAnswer } from '@app/wrong-note/adapters/wrongNotePreviousAnswer'
import { JaText } from '@common/components/JaText'
import { jaTextProps } from '@common/libs/jaSpacing'

type WrongNoteDetailContentProps = {
  action?: ReactNode
  data: WrongNoteDetailView
  previousAnswer: WrongNotePreviousAnswer
  headingRef?: RefObject<HTMLHeadingElement | null>
}

/** The choices: the correct one, and the learner's earlier wrong pick. */
const ReviewOptions = ({
  options,
  previousAnswer
}: {
  options: WrongNoteDetailView['question']['options']
  previousAnswer: WrongNotePreviousAnswer
}): ReactElement => {
  // Left uncompiled: the compiled parent already caches this section, and
  // compiling it too adds about 200 bytes gzip (#1124 bundle).
  'use no memo'
  const { t } = useTranslation('wrongNote')
  return (
    <ol className="review-options">
      {options.map((option) => {
        const isMine =
          previousAnswer.status === 'selected' &&
          previousAnswer.optionId === option.id &&
          !option.isCorrect
        return (
          <li
            key={option.id}
            className={
              option.isCorrect ? 'is-correct' : isMine ? 'is-mine' : ''
            }
          >
            <span {...jaTextProps(option.text)}>
              {option.label}. <JaText text={option.text} />
            </span>
            {isMine ? (
              <strong>
                <span className="review-answer-mark" aria-hidden="true">
                  ✕{' '}
                </span>
                <span>{t('detail.myAnswer')}</span>
              </strong>
            ) : null}
            {option.isCorrect ? (
              <strong className="wrong-note-correct">
                <span className="review-answer-mark" aria-hidden="true">
                  ○{' '}
                </span>
                <span>{t('detail.correctAnswer')}</span>
                {previousAnswer.status === 'selected' &&
                previousAnswer.optionId === option.id ? (
                  <span> · {t('detail.myAnswer')}</span>
                ) : null}
              </strong>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export const WrongNoteDetailContent = ({
  action,
  data,
  previousAnswer,
  headingRef
}: WrongNoteDetailContentProps): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  return (
    <>
      <p className="review-item-meta">
        <span>
          {data.question.level} ·{' '}
          {commonT(`taxonomy.subjects.${data.question.subject}`)} ·{' '}
          <span className="wrong-note-meta-wrong">
            {t('card.wrongCount', { count: data.wrongNote.wrongCount })}
          </span>
        </span>
      </p>
      {data.question.passage ? (
        <div className="review-passage" {...jaTextProps(data.question.passage)}>
          <JaText text={data.question.passage} />
        </div>
      ) : null}
      <h1
        ref={headingRef}
        className="review-question wrong-note-question"
        {...jaTextProps(data.question.questionText)}
        tabIndex={-1}
      >
        <JaText text={data.question.questionText} />
      </h1>
      {previousAnswer.status === 'unanswered' ? (
        <p className="review-notice" role="status">
          <span aria-hidden="true">– </span>
          <span>{t('detail.noAnswer')}</span>
        </p>
      ) : previousAnswer.status !== 'selected' ? (
        <p className="review-notice" role="status">
          {t(`detail.previousAnswer.${previousAnswer.status}`)}
        </p>
      ) : null}
      <ReviewOptions
        options={data.question.options}
        previousAnswer={previousAnswer}
      />
      <section
        className="review-explanation"
        aria-labelledby="review-detail-explanation"
      >
        <h2 id="review-detail-explanation">{t('detail.explanation')}</h2>
        <ExplanationLanguagePanel
          key={data.question.id}
          explanationJa={data.question.explanationJa}
          explanationKo={data.question.explanationKo}
        />
      </section>
      {data.wrongNote.reviewAvailability === 'ARCHIVED' ? (
        <p className="review-notice" role="status">
          {t('detail.review.archived')}
        </p>
      ) : null}
      {/* null means no review version is pinned yet (just answered wrong),
          which is not a change. */}
      {data.currentReviewQuestionVersionId !== null &&
      data.currentReviewQuestionVersionId !== data.question.questionVersionId &&
      data.wrongNote.reviewAvailability !== 'ARCHIVED' ? (
        <p className="review-notice">{t('detail.versionChanged')}</p>
      ) : null}
      {action ? <div className="review-document-actions">{action}</div> : null}
    </>
  )
}

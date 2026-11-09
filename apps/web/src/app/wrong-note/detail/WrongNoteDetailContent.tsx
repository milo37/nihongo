import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { ExplanationLanguagePanel } from '@common/components/ExplanationLanguagePanel'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import type { WrongNotePreviousAnswer } from '@app/wrong-note/adapters/wrongNotePreviousAnswer'

type WrongNoteDetailContentProps = {
  action?: ReactNode
  data: WrongNoteDetailView
  previousAnswer: WrongNotePreviousAnswer
  headingRef?: RefObject<HTMLHeadingElement | null>
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
          <span className="font-semibold text-danger">
            {t('card.wrongCount', { count: data.wrongNote.wrongCount })}
          </span>
        </span>
      </p>
      {data.question.passage ? (
        <div className="review-passage" lang="ja">
          {data.question.passage}
        </div>
      ) : null}
      <h1 ref={headingRef} className="review-question" lang="ja" tabIndex={-1}>
        {data.question.questionText}
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
      <ol className="review-options">
        {data.question.options.map((option) => {
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
              <span lang="ja">
                {option.label}. {option.text}
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
                <strong className="text-success-strong">
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

import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { ExplanationLanguagePanel } from '@common/components/ExplanationLanguagePanel'
import type { WrongNoteDetailView } from '@app/wrong-note/adapters/wrongNoteView'
import type { WrongNotePreviousAnswer } from '@app/wrong-note/adapters/wrongNotePreviousAnswer'
import { ReviewStatus } from '@app/wrong-note/components/ReviewStatus'

type WrongNoteDetailContentProps = {
  action?: ReactNode
  memo?: ReactNode
  data: WrongNoteDetailView
  previousAnswer: WrongNotePreviousAnswer
  headingRef?: RefObject<HTMLHeadingElement | null>
}

export const WrongNoteDetailContent = ({
  action,
  memo,
  data,
  previousAnswer,
  headingRef
}: WrongNoteDetailContentProps): ReactElement => {
  const { t } = useTranslation('wrongNote')
  const { t: commonT } = useTranslation('common')
  return (
    <>
      <h1 ref={headingRef} className="review-title" tabIndex={-1}>
        {t('integration.detail')}
      </h1>
      <div className="review-item-meta">
        <span>
          {data.question.level} ·{' '}
          {commonT(`taxonomy.subjects.${data.question.subject}`)}
        </span>
        <ReviewStatus status={data.wrongNote.status} />
      </div>
      <p className="review-notice">{t('detail.snapshotNotice')}</p>
      {data.question.passage ? (
        <div className="review-passage" lang="ja">
          {data.question.passage}
        </div>
      ) : null}
      <h2 className="review-question" lang="ja">
        {data.question.questionText}
      </h2>
      {previousAnswer.status !== 'selected' ? (
        <p className="review-notice" role="status">
          {t(`detail.previousAnswer.${previousAnswer.status}`)}
        </p>
      ) : null}
      <ol className="review-options">
        {data.question.options.map((option) => (
          <li key={option.id} className={option.isCorrect ? 'is-correct' : ''}>
            <span lang="ja">
              {option.label}. {option.text}
            </span>
            {previousAnswer.status === 'selected' &&
            previousAnswer.optionId === option.id ? (
              <strong>{t('detail.previousAnswer.selected')}</strong>
            ) : null}
            {option.isCorrect ? <strong>{t('detail.correct')}</strong> : null}
          </li>
        ))}
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
      {data.currentReviewQuestionVersionId !==
        data.question.questionVersionId &&
      data.wrongNote.reviewAvailability !== 'ARCHIVED' ? (
        <p className="review-notice">{t('integration.versionChanged')}</p>
      ) : null}
      {memo}
      {action ? <div className="review-document-actions">{action}</div> : null}
    </>
  )
}

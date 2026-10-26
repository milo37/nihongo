import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { QuestionReportDialog } from '@app/question-report/components/QuestionReportDialog'
import { Button } from '@nihongo/browser/common/components/Button'
import { ExplanationLanguagePanel } from '@common/components/ExplanationLanguagePanel'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'

type ResultQuestionDetailProps = {
  readonly item: StudyResultItemView
  readonly ordinal: number
  readonly canManage: boolean
  readonly isBookmarked: boolean
  readonly bookmarkDisabled: boolean
  readonly isResultSourceUnavailable: boolean
  readonly bookmarkMessage: string | null
  readonly onToggleBookmark: () => void
  readonly actions: ReactNode
}

export const ResultQuestionDetail = ({
  item,
  ordinal,
  canManage,
  isBookmarked,
  bookmarkDisabled,
  isResultSourceUnavailable,
  bookmarkMessage,
  onToggleBookmark,
  actions
}: ResultQuestionDetailProps): ReactElement => {
  const { i18n, t } = useTranslation('result')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formattedOrdinal = formatNumber(ordinal, locale)
  const selectedOption = item.question.options.find(
    (option) => option.id === item.selectedOptionId
  )
  const correctOption = item.question.options.find(
    (option) => option.id === item.correctOptionId
  )
  const status = item.isCorrect
    ? t('items.correct')
    : item.selectedOptionId === null
      ? t('items.unanswered')
      : t('items.incorrect')

  return (
    <article
      id="selected-result-question"
      className="study-result-detail"
      aria-labelledby="selected-result-question-title"
    >
      <div className="study-result-detail-heading">
        <p className={item.isCorrect ? 'text-success' : 'text-danger'}>
          {status} · {t('navigation.question', { formattedOrdinal })}
        </p>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={bookmarkDisabled || !item.question.questionVersionId}
              aria-label={t(
                isBookmarked ? 'bookmark.removeLabel' : 'bookmark.addLabel',
                { formattedOrdinal }
              )}
              aria-pressed={isBookmarked}
              data-selected={isBookmarked}
              onClick={onToggleBookmark}
            >
              <Icon name="bookmark" />
              {isBookmarked ? t('bookmark.remove') : t('bookmark.add')}
            </Button>
            {item.question.questionVersionId && !isResultSourceUnavailable ? (
              <QuestionReportDialog
                questionId={item.question.id}
                questionVersionId={item.question.questionVersionId}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {bookmarkMessage ? (
        <p className="mt-3 text-sm font-semibold text-warning" role="status">
          {bookmarkMessage}
        </p>
      ) : null}
      {item.tags.length > 0 ? (
        <p className="mt-3 text-sm text-muted">{item.tags.join(' · ')}</p>
      ) : null}
      {item.question.passage ? (
        <div className="study-result-passage" lang="ja">
          {item.question.passage}
        </div>
      ) : null}
      <h2
        id="selected-result-question-title"
        className="study-result-question-copy"
        lang="ja"
      >
        {item.question.questionText}
      </h2>
      <dl className="study-result-answer-comparison">
        <div>
          <dt className={item.isCorrect ? 'text-success' : 'text-danger'}>
            {t('items.selectedAnswer')}
          </dt>
          <dd lang={selectedOption ? 'ja' : undefined}>
            {selectedOption
              ? `${selectedOption.label}. ${selectedOption.text}`
              : t('items.unanswered')}
          </dd>
        </div>
        <div>
          <dt className="text-success">{t('items.correctAnswer')}</dt>
          <dd lang={correctOption ? 'ja' : undefined}>
            {correctOption
              ? `${correctOption.label}. ${correctOption.text}`
              : t('items.correctAnswerUnavailable')}
          </dd>
        </div>
      </dl>
      <section
        className="study-result-explanation"
        aria-labelledby="selected-result-explanation-title"
      >
        <h3 id="selected-result-explanation-title">{t('items.explanation')}</h3>
        <ExplanationLanguagePanel
          explanationJa={item.explanationJa}
          explanationKo={item.explanationKo}
        />
      </section>
      {actions}
    </article>
  )
}

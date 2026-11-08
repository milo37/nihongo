import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { QuestionReportDialog } from '@app/question-report/components/QuestionReportDialog'
import { Button } from '@nihongo/browser/common/components/Button'
import { classNames } from '@nihongo/browser/common/components/classNames'
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
  readonly bookmarkMessage: { text: string; isError: boolean } | null
  readonly onToggleBookmark: () => void
  readonly actions: ReactNode
}

/** Bookmark toggle and, when the version is known, the report dialog. */
const ResultManageButtons = ({
  item,
  ordinal,
  isBookmarked,
  bookmarkDisabled,
  isResultSourceUnavailable,
  onToggleBookmark
}: Pick<
  ResultQuestionDetailProps,
  | 'item'
  | 'ordinal'
  | 'isBookmarked'
  | 'bookmarkDisabled'
  | 'isResultSourceUnavailable'
  | 'onToggleBookmark'
>): ReactElement => {
  const { i18n, t } = useTranslation('result')
  const formattedOrdinal = formatNumber(
    ordinal,
    resolveUiLocale(i18n.resolvedLanguage)
  )
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        className="aria-disabled:cursor-wait aria-disabled:opacity-70"
        variant="ghost"
        disabled={!item.question.questionVersionId}
        // Focus stays here while busy (a toast closed with Esc returns to it).
        aria-disabled={bookmarkDisabled || undefined}
        aria-label={t(
          isBookmarked ? 'bookmark.removeLabel' : 'bookmark.addLabel',
          { formattedOrdinal }
        )}
        aria-pressed={isBookmarked}
        data-selected={isBookmarked}
        onClick={() => {
          if (!bookmarkDisabled) onToggleBookmark()
        }}
      >
        <Icon name="bookmark" />
        {isBookmarked ? t('bookmark.remove') : t('bookmark.add')}
      </Button>
      {item.question.questionVersionId && !isResultSourceUnavailable ? (
        <QuestionReportDialog
          questionId={item.question.id}
          questionVersionId={item.question.questionVersionId}
          ordinal={ordinal}
        />
      ) : null}
    </div>
  )
}

/** The learner's answer next to the correct answer. */
const ResultAnswerComparison = ({
  item
}: {
  item: StudyResultItemView
}): ReactElement => {
  const { t } = useTranslation('result')
  const selectedOption = item.question.options.find(
    (option) => option.id === item.selectedOptionId
  )
  const correctOption = item.question.options.find(
    (option) => option.id === item.correctOptionId
  )
  return (
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
  )
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
          <ResultManageButtons
            item={item}
            ordinal={ordinal}
            isBookmarked={isBookmarked}
            bookmarkDisabled={bookmarkDisabled}
            isResultSourceUnavailable={isResultSourceUnavailable}
            onToggleBookmark={onToggleBookmark}
          />
        ) : null}
      </div>
      {bookmarkMessage ? (
        <p
          className={classNames(
            'mt-3 text-sm font-semibold',
            bookmarkMessage.isError ? 'text-danger' : 'text-warning'
          )}
          role={bookmarkMessage.isError ? 'alert' : 'status'}
        >
          {bookmarkMessage.text}
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
      <ResultAnswerComparison item={item} />
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

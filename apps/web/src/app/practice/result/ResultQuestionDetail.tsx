import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { QuestionReportDialog } from '@app/question-report/components/QuestionReportDialog'
import { Button } from '@nihongo/browser/common/components/Button'
import { classNames } from '@nihongo/browser/common/components/classNames'
import { ExplanationLanguagePanel } from '@common/components/ExplanationLanguagePanel'
import { Icon } from '@nihongo/browser/common/components/Icon'
import {
  getResultStatus,
  ResultStatusIcon
} from '@app/practice/result/ResultStatusIcon'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { jaTextProps } from '@common/libs/jaSpacing'

type ResultQuestionDetailProps = {
  readonly item: StudyResultItemView
  readonly ordinal: number
  /** Guests see the bookmark (it explains sign-in) but not the report. */
  readonly canReport: boolean
  readonly isBookmarked: boolean
  readonly bookmarkDisabled: boolean
  readonly isResultSourceUnavailable: boolean
  readonly bookmarkMessage: { text: string; isError: boolean } | null
  readonly onToggleBookmark: () => void
}

/** Bookmark toggle and, when the version is known, the report dialog. */
const ResultManageButtons = ({
  item,
  ordinal,
  canReport,
  isBookmarked,
  bookmarkDisabled,
  isResultSourceUnavailable,
  onToggleBookmark
}: Pick<
  ResultQuestionDetailProps,
  | 'item'
  | 'ordinal'
  | 'canReport'
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
      {canReport &&
      item.question.questionVersionId &&
      !isResultSourceUnavailable ? (
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
        <dd {...(selectedOption ? jaTextProps(selectedOption.text) : {})}>
          {selectedOption
            ? `${selectedOption.label}. ${selectedOption.text}`
            : t('items.unanswered')}
        </dd>
      </div>
      <div>
        <dt className="text-success">{t('items.correctAnswer')}</dt>
        <dd {...(correctOption ? jaTextProps(correctOption.text) : {})}>
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
  canReport,
  isBookmarked,
  bookmarkDisabled,
  isResultSourceUnavailable,
  bookmarkMessage,
  onToggleBookmark
}: ResultQuestionDetailProps): ReactElement => {
  const { i18n, t } = useTranslation('result')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formattedOrdinal = formatNumber(ordinal, locale)
  const status = getResultStatus(item)

  return (
    <article
      id="selected-result-question"
      className="study-result-detail"
      aria-labelledby="selected-result-question-title"
    >
      <div className="study-result-detail-heading">
        <p className={item.isCorrect ? 'text-success' : 'text-danger'}>
          <ResultStatusIcon status={status} />
          {t(`items.${status}`)} ·{' '}
          {t('navigation.question', { formattedOrdinal })}
        </p>
        {
          <ResultManageButtons
            item={item}
            ordinal={ordinal}
            canReport={canReport}
            isBookmarked={isBookmarked}
            bookmarkDisabled={bookmarkDisabled}
            isResultSourceUnavailable={isResultSourceUnavailable}
            onToggleBookmark={onToggleBookmark}
          />
        }
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
        <div
          className="study-result-passage"
          {...jaTextProps(item.question.passage)}
        >
          {item.question.passage}
        </div>
      ) : null}
      <h2
        id="selected-result-question-title"
        className="study-result-question-copy"
        {...jaTextProps(item.question.questionText)}
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
    </article>
  )
}

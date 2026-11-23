import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { QuestionReportDialog } from '@app/question-report/components/QuestionReportDialog'
import { Button } from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { JaText } from '@common/components/JaText'
import { jaTextProps } from '@common/libs/jaSpacing'
import type { ResultQuestionDetailProps } from '@app/practice/result/ResultQuestionDetail'

/** Bookmark toggle and, when the version is known, the report dialog. */
export const ResultManageButtons = ({
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
        // JLP-878: the words stay '책갈피'; the ribbon fills in brand red
        // when it is in, and the button draws no pressed box.
        className="ui-button-toggle-icon aria-disabled:cursor-wait aria-disabled:opacity-70 aria-pressed:[&_svg]:fill-current aria-pressed:[&_svg]:text-brand"
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
        {t('bookmark.add')}
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
export const ResultAnswerComparison = ({
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
          {selectedOption ? (
            <>
              {selectedOption.label}. <JaText text={selectedOption.text} />
            </>
          ) : (
            t('items.unanswered')
          )}
        </dd>
      </div>
      <div>
        <dt className="text-success">{t('items.correctAnswer')}</dt>
        <dd {...(correctOption ? jaTextProps(correctOption.text) : {})}>
          {correctOption ? (
            <>
              {correctOption.label}. <JaText text={correctOption.text} />
            </>
          ) : (
            t('items.correctAnswerUnavailable')
          )}
        </dd>
      </div>
    </dl>
  )
}

import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { StudyResultItemView } from '@app/practice/adapters/studyResultView'
import { classNames } from '@nihongo/browser/common/components/classNames'
import { Explanation } from '@common/components/Explanation'
import {
  getResultStatus,
  ResultStatusIcon
} from '@app/practice/result/ResultStatusIcon'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { getTagLabelInLocale } from '@common/libs/tagLabel'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { JaText } from '@common/components/JaText'
import { jaTextProps } from '@common/libs/jaSpacing'
import { SamePassageNote } from '@app/practice/components/SamePassageNote'
import {
  ResultAnswerComparison,
  ResultManageButtons
} from '@app/practice/result/ResultQuestionSections'

export type ResultQuestionDetailProps = {
  readonly item: StudyResultItemView
  readonly ordinal: number
  /** #986: the number of the first question on this passage, if earlier. */
  readonly samePassageOrdinal?: number | null
  /** Guests see the bookmark (it explains sign-in) but not the report. */
  readonly canReport: boolean
  readonly isBookmarked: boolean
  readonly bookmarkDisabled: boolean
  readonly isResultSourceUnavailable: boolean
  readonly bookmarkMessage: { text: string; isError: boolean } | null
  readonly onToggleBookmark: () => void
}

export const ResultQuestionDetail = ({
  item,
  ordinal,
  samePassageOrdinal = null,
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
  // One language per screen: a Japanese screen shows only tags with a
  // Japanese name, and none from the Korean-only legacy result (no summaries).
  const tagLabels = item.question.tagSummaries
    ? item.question.tagSummaries.flatMap((tag) => {
        const label = getTagLabelInLocale(tag, locale)
        return label ? [label] : []
      })
    : locale === 'ja'
      ? []
      : item.tags

  return (
    <article
      id="selected-result-question"
      className="study-result-detail"
      aria-labelledby="selected-result-question-title"
    >
      <div className="study-result-detail-heading">
        <p
          className={
            item.isCorrect ? 'result-mark-correct' : 'result-mark-wrong'
          }
        >
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
            'result-bookmark-note',
            bookmarkMessage.isError
              ? 'result-bookmark-error'
              : 'result-bookmark-warning'
          )}
          role={bookmarkMessage.isError ? 'alert' : 'status'}
        >
          {bookmarkMessage.text}
        </p>
      ) : null}
      {tagLabels.length > 0 ? (
        <p className="study-result-tags">{tagLabels.join(' · ')}</p>
      ) : null}
      {item.question.passage && samePassageOrdinal !== null ? (
        <SamePassageNote
          text={t('items.samePassage', {
            formattedOrdinal: formatNumber(samePassageOrdinal, locale)
          })}
          tone="result"
        />
      ) : null}
      {item.question.passage ? (
        <div
          className="study-result-passage"
          {...jaTextProps(item.question.passage)}
        >
          <JaText text={item.question.passage} />
        </div>
      ) : null}
      <h2
        id="selected-result-question-title"
        className="study-result-question-copy"
        {...jaTextProps(item.question.questionText)}
      >
        <JaText text={item.question.questionText} />
      </h2>
      <ResultAnswerComparison item={item} />
      <section
        className="study-result-explanation"
        aria-labelledby="selected-result-explanation-title"
      >
        <h3 id="selected-result-explanation-title">{t('items.explanation')}</h3>
        <Explanation
          explanationJa={item.explanationJa}
          explanationKo={item.explanationKo}
        />
      </section>
    </article>
  )
}

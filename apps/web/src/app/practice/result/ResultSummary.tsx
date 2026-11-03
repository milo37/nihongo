import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import type { StudyResultView } from '@app/practice/adapters/studyResultView'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { useResultNumberFormat } from '@app/practice/hooks/useResultNumberFormat'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { getButtonClassName } from '@nihongo/browser/common/components/Button'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'

type ResultSummaryProps = {
  headingRef: RefObject<HTMLHeadingElement | null>
  isGuest: boolean
  result: StudyResultView
  session: StudySessionView['session']
}

export const ResultSummary = ({
  headingRef,
  isGuest,
  result,
  session
}: ResultSummaryProps): ReactElement => {
  const { t } = useTranslation('result')
  const { t: commonT } = useTranslation('common')
  const { formatCount, formatDuration, locale } = useResultNumberFormat()
  const metrics = [
    {
      id: 'total',
      label: t('metrics.total'),
      value: formatCount(result.totalCount)
    },
    {
      id: 'correct',
      label: t('metrics.correct'),
      value: formatCount(result.correctCount)
    },
    {
      id: 'incorrect',
      label: t('metrics.incorrect'),
      value: formatCount(result.incorrectCount)
    },
    {
      id: 'accuracy',
      label: t('metrics.accuracy'),
      value: `${formatNumber(result.correctRate, locale, {
        maximumFractionDigits: 2
      })}%`
    },
    {
      id: 'duration',
      label: t('metrics.duration'),
      value: formatDuration(result.durationSec)
    }
  ]

  return (
    <div className="study-result-summary border-b border-line pb-6">
      <div className="flex flex-wrap gap-2">
        <Badge variant="brand">{session.level}</Badge>
        <Badge>{commonT(`taxonomy.subjects.${session.subject}`)}</Badge>
      </div>
      <h1
        ref={headingRef}
        className="mt-3 rounded-sm text-2xl font-black sm:text-3xl"
        tabIndex={-1}
      >
        {t('name')}
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted">{t('description')}</p>

      <p className="mt-5 text-lg font-bold">
        {t('outcomes', {
          correct: formatCount(result.correctCount),
          wrong: formatCount(
            result.items.filter(
              (item) => !item.isCorrect && item.selectedOptionId !== null
            ).length
          ),
          unanswered: formatCount(
            result.items.filter((item) => item.selectedOptionId === null).length
          )
        })}
      </p>
      <p className="mt-2 text-sm leading-6 text-muted">{t('outcomesNote')}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a className={getButtonClassName()} href="#result-explanations">
          {t('reviewExplanations')}
        </a>
        <Link
          className="note-link"
          to={isGuest ? '/' : '/dashboard?view=learning'}
        >
          {t('finish')}
        </Link>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-5">
        {metrics.map(({ id, label, value }) => (
          <div key={id} className="min-w-0">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-1 font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

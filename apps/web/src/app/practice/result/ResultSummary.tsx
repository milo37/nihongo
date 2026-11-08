import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import type { StudyResultView } from '@app/practice/adapters/studyResultView'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { useResultNumberFormat } from '@app/practice/hooks/useResultNumberFormat'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'

type ResultSummaryProps = {
  headingRef: RefObject<HTMLHeadingElement | null>
  incorrectCount: number
  isGuest: boolean
  /** A guest's last try today: the L20 box holds the login button. */
  isGuestDone: boolean
  result: StudyResultView
  session: StudySessionView['session']
}

/** One block: the score with rate and time, then a one-line note. */
export const ResultSummary = ({
  headingRef,
  incorrectCount,
  isGuest,
  isGuestDone,
  result,
  session
}: ResultSummaryProps): ReactElement => {
  const { t } = useTranslation('result')
  const { t: commonT } = useTranslation('common')
  const { formatCount, formatDuration, locale } = useResultNumberFormat()
  const unansweredCount = result.items.filter(
    (item) => item.selectedOptionId === null
  ).length
  const details = [
    `${t('metrics.accuracy')} ${formatNumber(result.correctRate, locale, {
      maximumFractionDigits: 2
    })}%`,
    formatDuration(result.durationSec),
    ...(unansweredCount > 0
      ? [`${t('items.unanswered')} ${formatCount(unansweredCount)}`]
      : [])
  ]

  return (
    <div className="study-result-summary">
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
      <p className="mt-4 flex flex-wrap items-baseline gap-3 text-xl font-bold text-muted">
        <span>
          <strong className="text-[34px] font-black leading-none text-ink sm:text-[40px]">
            {formatCount(result.correctCount)}
          </strong>{' '}
          {t('scoreTotal', { formattedTotal: formatCount(result.totalCount) })}
        </span>
        <span className="text-sm font-normal">{details.join(' · ')}</span>
      </p>
      {/* One login place: beside this line, or in the L20 box. */}
      {isGuest || incorrectCount > 0 ? (
        <p className="mt-2 text-sm leading-6 text-muted">
          {isGuest
            ? t('status.guest')
            : t('status.savedWrongCount', {
                formattedCount: formatCount(incorrectCount)
              })}
          {isGuest && !isGuestDone ? (
            <Link
              className="note-link ms-2"
              to={`/login?redirect=${encodeURIComponent('/practice')}`}
            >
              {t('actions.loginChoice')}
            </Link>
          ) : null}
        </p>
      ) : null}
      {unansweredCount > 0 ? (
        <p className="mt-1 text-sm leading-6 text-muted">{t('outcomesNote')}</p>
      ) : null}
    </div>
  )
}

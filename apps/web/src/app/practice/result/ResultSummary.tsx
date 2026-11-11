import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import type { StudyResultView } from '@app/practice/adapters/studyResultView'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { useResultNumberFormat } from '@app/practice/hooks/useResultNumberFormat'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import {
  gradeTiming,
  ProgressSheet
} from '@common/components/manuscript/ProgressSheet'
import type { ProgressCellState } from '@common/components/manuscript/ProgressSheet'

const SCORE_SLOT = '\u0000'

type ResultSummaryProps = {
  /** Play the red pen once (right after submit). */
  animateGrading?: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
  incorrectCount: number
  isGuest: boolean
  /** A guest's last try today: the limit card holds the login button. */
  isGuestDone: boolean
  result: StudyResultView
  session: StudySessionView['session']
}

/** One block: the score with rate and time, then a one-line note. */
export const ResultSummary = ({
  animateGrading = false,
  headingRef,
  incorrectCount,
  isGuest,
  isGuestDone,
  result,
  session
}: ResultSummaryProps): ReactElement => {
  const { t } = useTranslation('result')
  const { t: commonT } = useTranslation('common')
  const { t: authT } = useTranslation('auth')
  const { formatCount, formatDuration, locale } = useResultNumberFormat()
  const unansweredCount = result.items.filter(
    (item) => item.selectedOptionId === null
  ).length
  const details = [
    t('summary.meta', {
      accuracy: `${formatNumber(result.correctRate, locale, {
        maximumFractionDigits: 2
      })}%`,
      duration: formatDuration(result.durationSec)
    }),
    ...(unansweredCount > 0
      ? [`${t('items.unanswered')} ${formatCount(unansweredCount)}`]
      : [])
  ]
  // Unanswered items get the grey dash, never the blank 'todo' square.
  const gradeStates = result.items.map(
    (item): ProgressCellState =>
      item.isCorrect ? 'ok' : item.selectedOptionId === null ? 'skip' : 'ng'
  )
  // Only the correct count is large; split the sentence around it.
  const [scoreBefore = '', scoreAfter = ''] = t('summary.score', {
    total: formatCount(result.totalCount),
    correct: SCORE_SLOT
  }).split(SCORE_SLOT)

  return (
    <div className="study-result-summary">
      {/* The score sentence is the heading (B4 §11). */}
      <h1
        ref={headingRef}
        className="result-b4-score outline-none"
        tabIndex={-1}
      >
        {scoreBefore}
        <b
          className={
            result.correctCount >= 10
              ? 'result-b4-number is-wide'
              : 'result-b4-number'
          }
        >
          {formatCount(result.correctCount)}
          {/* The teacher's red circle on the score only (B4 §4). */}
          <svg
            className="result-b4-ring"
            viewBox="0 0 24 22"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              className={animateGrading ? 'manuscript-pen' : undefined}
              style={
                animateGrading
                  ? {
                      animationDelay: `${gradeTiming(result.items.length).scoreCircleMs}ms`,
                      animationDuration: '400ms'
                    }
                  : undefined
              }
              pathLength={1}
              d="M15.5 3.2C9 1.6 3 5.6 3.4 11.6c.4 5.6 7 8.4 12.2 6.2 4.6-2 5.6-7.6 2.4-11.4"
            />
          </svg>
        </b>
        {scoreAfter}
      </h1>
      <p className="result-b4-meta">
        {[
          session.level,
          commonT(`taxonomy.subjects.${session.subject}`),
          ...details
        ].join(' · ')}
      </p>
      <ProgressSheet
        className="study-result-sheet"
        states={gradeStates}
        animate={animateGrading}
      />
      {/* One login place: this line, or the limit card on the last try. */}
      {isGuest ? (
        isGuestDone ? null : incorrectCount > 0 ? (
          // One ruled line: the offer, then [로그인 ›] (B4 §4).
          <p className="result-guest-keep">
            <span>
              {t('status.guest', {
                formattedCount: formatCount(incorrectCount)
              })}
            </span>
            <Link
              className="result-guest-keep-action"
              to={`/login?redirect=${encodeURIComponent('/wrong-notes')}`}
            >
              {authT('guestToast.login')}
              <Icon name="chevron-right" className="size-4" />
            </Link>
          </p>
        ) : (
          <p className="mt-2 text-sm leading-6 text-muted">
            {t('status.guestAllCorrect')}
            <Link
              className="note-link ms-2"
              to={`/login?redirect=${encodeURIComponent('/practice')}`}
            >
              {authT('guestToast.login')}
            </Link>
          </p>
        )
      ) : incorrectCount > 0 ? (
        <p className="mt-2 text-sm leading-6 text-muted">
          {t('status.savedWrongCount', {
            formattedCount: formatCount(incorrectCount)
          })}
        </p>
      ) : null}
      {unansweredCount > 0 ? (
        <p className="mt-1 text-sm leading-6 text-muted">{t('outcomesNote')}</p>
      ) : null}
    </div>
  )
}

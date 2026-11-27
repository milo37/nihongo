import { useTranslation } from 'react-i18next'
import type { ReactElement, RefObject } from 'react'
import type { StudyResultView } from '@app/practice/adapters/studyResultView'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { useResultNumberFormat } from '@app/practice/hooks/useResultNumberFormat'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { ProgressSheet } from '@common/components/manuscript/ProgressSheet'
import type { ProgressCellState } from '@common/components/manuscript/ProgressSheet'
import { DailyGoalLine } from '@app/practice/result/DailyGoalLine'
import {
  ResultScoreHeading,
  ResultStatusLine
} from '@app/practice/result/ResultSummarySections'

const SCORE_SLOT = '\u0000'

type ResultSummaryProps = {
  /** Play the red pen once (right after submit). */
  animateGrading?: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
  incorrectCount: number
  isGuest: boolean
  /** A guest's last try today: the limit card holds the login button. */
  isGuestDone: boolean
  /** #1090: a member's id for today's goal line; null for guests. */
  memberId: string | null
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
  memberId,
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
  const gradeStates = result.items.map((item): ProgressCellState =>
    item.isCorrect ? 'ok' : item.selectedOptionId === null ? 'skip' : 'ng'
  )
  // Only the correct count is large; split the sentence around it.
  const [scoreBefore = '', scoreAfter = ''] = t('summary.score', {
    total: formatCount(result.totalCount),
    correct: SCORE_SLOT
  }).split(SCORE_SLOT)

  return (
    <div className="study-result-summary">
      <ResultScoreHeading
        headingRef={headingRef}
        scoreBefore={scoreBefore}
        scoreAfter={scoreAfter}
        correctCount={result.correctCount}
        formattedCorrect={formatCount(result.correctCount)}
        itemCount={result.items.length}
        animateGrading={animateGrading}
      />
      <p className="result-b4-meta">
        {[
          session.level,
          commonT(`taxonomy.subjects.${session.subject}`),
          ...details
        ].join(' · ')}
      </p>
      {/* #1090 r7: right under the grey info line (the later stamp ends it). */}
      {memberId ? (
        <DailyGoalLine
          userId={memberId}
          sessionId={result.sessionId}
          stampEarned={result.stampEarned === true}
          submittedAt={result.submittedAt}
        />
      ) : null}
      <ProgressSheet
        className="study-result-sheet"
        states={gradeStates}
        animate={animateGrading}
      />
      <ResultStatusLine
        isGuest={isGuest}
        isGuestDone={isGuestDone}
        incorrectCount={incorrectCount}
        formatCount={formatCount}
      />
      {unansweredCount > 0 ? (
        <p className="study-result-outcomes-note">{t('outcomesNote')}</p>
      ) : null}
    </div>
  )
}

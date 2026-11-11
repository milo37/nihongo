import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { PracticeNavigationContext } from '@app/layout'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'
import { ProgressSheet } from '@common/components/manuscript/ProgressSheet'
import type { ProgressCellState } from '@common/components/manuscript/ProgressSheet'

type PracticeSessionHeaderProps = {
  answeredCount: number
  bookmarkButton: ReactNode
  currentNumber: number
  isBackDisabled: boolean
  isQuestionSheetDisabled: boolean
  onOpenQuestionSheet: () => void
  /** One state per question for the manuscript strip (B4 §3). */
  progressStates: readonly ProgressCellState[]
  reviewContext: PracticeNavigationContext['reviewReturnContext']
  session: StudySessionView['session']
  total: number
}

/** Top bar: close, the manuscript strip, "3 / 10" (opens the number sheet), bookmark. */
export const PracticeSessionHeader = ({
  answeredCount,
  bookmarkButton,
  currentNumber,
  isBackDisabled,
  isQuestionSheetDisabled,
  onOpenQuestionSheet,
  progressStates,
  reviewContext,
  session,
  total
}: PracticeSessionHeaderProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const { formatCount } = usePracticeNumberFormat()
  const position = `${formatCount(currentNumber)} / ${formatCount(total)}`

  return (
    <header
      className={`border-b border-line bg-surface ${reviewContext ? 'study-session-context' : ''}`}
    >
      <div className="study-session-bar mx-auto flex h-14 max-w-6xl lg:h-16 items-center gap-1 px-2">
        <Link
          className="note-link size-11 shrink-0 justify-center"
          aria-label={t(
            reviewContext
              ? 'session.header.backToExplanation'
              : 'session.header.backToSetup'
          )}
          aria-disabled={isBackDisabled}
          onClick={(event) => {
            if (isBackDisabled) {
              event.preventDefault()
            }
          }}
          to={
            reviewContext
              ? `/wrong-notes/${reviewContext.questionId}?returnTo=${encodeURIComponent(reviewContext.returnTo)}`
              : '/practice'
          }
        >
          <Icon name="x" />
        </Link>
        {/* Phone: the ten-square row holding this question. PC: one row
            (28px squares, 20 fit in 560). The progress element below speaks. */}
        <div className="study-session-sheet">
          <ProgressSheet
            className="study-session-sheet-phone"
            states={progressStates}
            rowOf={currentNumber - 1}
          />
          <ProgressSheet
            className="study-session-sheet-pc"
            states={progressStates}
            singleRowCellSize={28}
          />
        </div>
        <p className="flex shrink-0 items-center text-base font-bold">
          {total > 1 ? (
            <button
              className="min-h-11 shrink-0 rounded-control px-1 tabular-nums underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              type="button"
              aria-haspopup="dialog"
              aria-label={`${t('session.navigation.jumpLabel')} ${position}`}
              disabled={isQuestionSheetDisabled}
              onClick={onOpenQuestionSheet}
            >
              {position}
            </button>
          ) : (
            <span className="shrink-0 tabular-nums">{position}</span>
          )}
        </p>
        <div className="flex size-11 shrink-0 items-center justify-center">
          {bookmarkButton}
        </div>
      </div>
      <p className="study-session-meta mx-auto max-w-6xl px-4">
        {session.level} · {commonT(`taxonomy.subjects.${session.subject}`)}
      </p>
      <progress
        className="sr-only"
        aria-label={t('session.header.progressSummary', {
          answered: formatCount(answeredCount),
          current: formatCount(currentNumber),
          total: formatCount(total)
        })}
        max={total}
        value={answeredCount}
      />
    </header>
  )
}

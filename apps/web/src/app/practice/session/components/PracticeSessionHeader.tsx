import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { PracticeNavigationContext } from '@app/layout'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'
import {
  getSetReturnPath,
  setReturnLabelKey
} from '@app/practice/setReturnPath'
import { ProgressSheet } from '@common/components/manuscript/ProgressSheet'
import type { ProgressCellState } from '@common/components/manuscript/ProgressSheet'

type PracticeSessionHeaderProps = {
  answeredCount: number
  bookmarkButton: ReactNode
  currentNumber: number
  /** Phone: with a passage the meta line takes the passage's gutter. */
  hasPassage: boolean
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
  hasPassage,
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
  // JLP-856: ✕ goes back to the list the set came from; a random set goes
  // to the practice setup as before.
  const returnPath = getSetReturnPath(session.mode)

  return (
    <header
      className={`study-session-header ${reviewContext ? 'study-session-context' : ''}`}
    >
      <div className="study-session-bar">
        <Link
          className="note-link study-session-back"
          aria-label={
            reviewContext
              ? t('session.header.backToExplanation')
              : returnPath
                ? t(setReturnLabelKey[returnPath], { ns: 'result' })
                : t('session.header.backToSetup')
          }
          aria-disabled={isBackDisabled}
          onClick={(event) => {
            if (isBackDisabled) {
              event.preventDefault()
            }
          }}
          to={
            reviewContext
              ? `/wrong-notes/${reviewContext.questionId}?returnTo=${encodeURIComponent(reviewContext.returnTo)}`
              : (returnPath ?? '/practice')
          }
        >
          <Icon name="x" />
        </Link>
        {/* Phone: the row of up to ten holding this question, filling the
            space up to 28px squares. PC: one row of every square, filling
            the space up to 28px (20 fit in 560). Numbers drop under 17px
            (the current square is then filled). The progress element speaks. */}
        <div className="study-session-sheet">
          <ProgressSheet
            className="study-session-sheet-phone"
            states={progressStates}
            rowOf={currentNumber - 1}
            maxCellSize={28}
          />
          <ProgressSheet
            className="study-session-sheet-pc"
            states={progressStates}
            singleRowCellSize={28}
          />
        </div>
        <p className="study-session-position">
          {total > 1 ? (
            <button
              className="study-session-jump"
              type="button"
              aria-haspopup="dialog"
              aria-label={`${t('session.navigation.jumpLabel')} ${position}`}
              disabled={isQuestionSheetDisabled}
              onClick={onOpenQuestionSheet}
            >
              {position}
            </button>
          ) : (
            <span className="study-session-count">{position}</span>
          )}
        </p>
        <div className="study-session-bookmark-slot">{bookmarkButton}</div>
      </div>
      <p
        className={`study-session-meta ${hasPassage ? 'study-session-meta-wide' : ''}`}
      >
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

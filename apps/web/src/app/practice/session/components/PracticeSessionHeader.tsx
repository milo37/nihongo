import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { PracticeNavigationContext } from '@app/layout'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'

type PracticeSessionHeaderProps = {
  answeredCount: number
  bookmarkButton: ReactNode
  currentNumber: number
  isBackDisabled: boolean
  isQuestionSheetDisabled: boolean
  onOpenQuestionSheet: () => void
  reviewContext: PracticeNavigationContext['reviewReturnContext']
  session: StudySessionView['session']
  total: number
}

/** Top bar: back, "N1 Reading 1 / 3" (opens the number sheet), bookmark, progress. */
export const PracticeSessionHeader = ({
  answeredCount,
  bookmarkButton,
  currentNumber,
  isBackDisabled,
  isQuestionSheetDisabled,
  onOpenQuestionSheet,
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
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-2">
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
          <Icon name="chevron-left" />
        </Link>
        <p className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-base font-bold">
          <span className="truncate">
            {session.level} {commonT(`taxonomy.subjects.${session.subject}`)}
          </span>
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
      <progress
        className="ui-progress block h-1 w-full"
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

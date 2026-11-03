import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { Progress } from '@common/components/Progress'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { PracticeNavigationContext } from '@app/layout'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { usePracticeNumberFormat } from '@app/practice/hooks/usePracticeNumberFormat'

type PracticeSessionHeaderProps = {
  answeredCount: number
  currentNumber: number
  isBackDisabled: boolean
  reviewContext: PracticeNavigationContext['reviewReturnContext']
  session: StudySessionView['session']
  total: number
}

export const PracticeSessionHeader = ({
  answeredCount,
  currentNumber,
  isBackDisabled,
  reviewContext,
  session,
  total
}: PracticeSessionHeaderProps): ReactElement => {
  const { t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const { formatCount } = usePracticeNumberFormat()
  const progressValue = Math.round((answeredCount / total) * 100)

  return (
    <header
      className={reviewContext ? 'study-session-context' : 'study-focus-header'}
    >
      <div className="study-focus-header-inner">
        <Link
          className="note-link size-11 justify-center"
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
        <div>
          <p className="study-session-title">
            {session.level} {commonT(`taxonomy.subjects.${session.subject}`)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="text-sm text-muted">
              {commonT(`taxonomy.studyModes.${session.mode}`)}
            </span>
          </div>
          <div className="mt-3">
            <Progress
              label={t('session.header.progressSummary', {
                answered: formatCount(answeredCount),
                current: formatCount(currentNumber),
                total: formatCount(total)
              })}
              value={progressValue}
              showValue={false}
            />
          </div>
        </div>
      </div>
    </header>
  )
}

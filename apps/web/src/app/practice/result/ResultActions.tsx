import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { StudySessionView } from '@app/practice/adapters/studySessionView'
import { useResultNumberFormat } from '@app/practice/hooks/useResultNumberFormat'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'

type ResultActionsProps = {
  incorrectCount: number
  isGuest: boolean
  isRetryDisabled: boolean
  isRetryLoading: boolean
  onRetry: () => void
  retryLoadingLabel: string
  session: StudySessionView['session']
  showRetry: boolean
}

export const ResultActions = ({
  incorrectCount,
  isGuest,
  isRetryDisabled,
  isRetryLoading,
  onRetry,
  retryLoadingLabel,
  session,
  showRetry
}: ResultActionsProps): ReactElement => {
  const { t } = useTranslation('result')
  const { formatCount } = useResultNumberFormat()
  return (
    <div className="study-result-actions mt-4 flex flex-col gap-3">
      <p className="text-sm leading-6 text-muted">
        {isGuest
          ? t('status.guest')
          : t('status.savedWrongCount', {
              formattedCount: formatCount(incorrectCount)
            })}
      </p>
      <div className="flex flex-wrap gap-2">
        {showRetry ? (
          <Button
            size="lg"
            disabled={isRetryDisabled}
            isLoading={isRetryLoading}
            loadingLabel={retryLoadingLabel}
            onClick={onRetry}
          >
            {t('actions.retryIncorrect')}
          </Button>
        ) : null}
        <Link
          className={getButtonClassName({ variant: 'outline' })}
          to="/bookmarks"
        >
          {t('navigation.openBookmarks')}
        </Link>
        <Link
          className="note-link"
          to={
            isGuest
              ? `/login?redirect=${encodeURIComponent('/practice')}`
              : `/wrong-notes?level=${session.level}&subject=${session.subject}&view=UNREVIEWED`
          }
        >
          {isGuest ? t('actions.loginChoice') : t('actions.openWrongNotes')}
        </Link>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-control px-4 py-2.5 text-sm font-semibold text-muted hover:bg-surface-muted focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
          to="/practice"
        >
          {t('newPractice')}
        </Link>
      </div>
    </div>
  )
}

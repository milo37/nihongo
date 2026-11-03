import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { PracticeResultBookmark } from '@app/practice/hooks/usePracticeResultBookmark'
import type { ResultRetryStatusCode } from '@app/practice/hooks/usePracticeResultController'
import { Button } from '@nihongo/browser/common/components/Button'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'

type ResultSourceNoticeProps = {
  isError: boolean
  isPaused: boolean
  onRetry: () => void
}

export const ResultSourceNotice = ({
  isError,
  isPaused,
  onRetry
}: ResultSourceNoticeProps): ReactElement => {
  const { t } = useTranslation('result')
  const { t: commonT } = useTranslation('common')
  return (
    <div
      className="mb-6 rounded-lg border border-warning-line bg-warning-soft p-4 text-sm text-warning-strong"
      role={isError ? 'alert' : 'status'}
    >
      <p className="font-semibold">
        {t(isPaused ? 'error.cachedOffline' : 'error.staleDescription')}
      </p>
      {isError ? (
        <Button
          className="mt-3"
          size="sm"
          variant="secondary"
          onClick={onRetry}
        >
          {commonT('actions.retry')}
        </Button>
      ) : null}
    </div>
  )
}

type ResultRetryNoticeProps = {
  canRequestCanonicalRetry: boolean
  hasNoEligibleRetry: boolean
  hasRetryRequestError: boolean
  incorrectCount: number
  isRetryPaused: boolean
  retryMessage: ResultRetryStatusCode | null
}

export const ResultRetryNotice = ({
  canRequestCanonicalRetry,
  hasNoEligibleRetry,
  hasRetryRequestError,
  incorrectCount,
  isRetryPaused,
  retryMessage
}: ResultRetryNoticeProps): ReactElement | null => {
  const { t } = useTranslation('result')
  const newPracticeLink = (
    <Link className="note-link" to="/practice">
      {t('newPractice')}
    </Link>
  )

  if (hasNoEligibleRetry) {
    return (
      <EmptyState
        autoFocus
        className="mt-4 rounded-lg border border-warning-line bg-warning-soft"
        title={t('retry.noEligibleTitle')}
        description={t('retry.noEligibleDescription')}
        action={newPracticeLink}
      />
    )
  }
  if (incorrectCount > 0 && !canRequestCanonicalRetry) {
    return (
      <p
        className="mt-4 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong"
        role="status"
      >
        {t('retry.unsupported')}
      </p>
    )
  }
  if (incorrectCount === 0) {
    return (
      <EmptyState
        className="mt-4 rounded-lg border border-success-line bg-success-soft"
        title={t('retry.allCorrectTitle')}
        description={t('retry.allCorrectDescription')}
        action={newPracticeLink}
      />
    )
  }
  if (isRetryPaused) {
    return (
      <p
        className="mt-4 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong"
        role="status"
        aria-live="polite"
      >
        {t('retry.offline')}
      </p>
    )
  }
  if (hasRetryRequestError) {
    return (
      <div
        className="mt-4 rounded-lg border border-danger-line bg-danger-soft p-4 text-sm text-danger-strong"
        role="alert"
      >
        <p className="font-bold">{t('retry.errorTitle')}</p>
        <p className="mt-1 leading-6">{t('retry.errorDescription')}</p>
      </div>
    )
  }
  if (retryMessage) {
    return (
      <p
        className="mt-4 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong"
        role="status"
        aria-live="polite"
      >
        {t(`retry.${retryMessage}`)}
      </p>
    )
  }
  return null
}

type ResultBookmarkNoticesProps = {
  bookmark: PracticeResultBookmark
  isGuest: boolean
}

export const ResultBookmarkNotices = ({
  bookmark,
  isGuest
}: ResultBookmarkNoticesProps): ReactElement => {
  const { t } = useTranslation('result')
  const { bookmarksQuery, isMutationPaused } = bookmark
  return (
    <>
      {isMutationPaused ? (
        <p
          className="rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong"
          role="status"
          aria-live="polite"
        >
          {t('bookmark.offline')}
        </p>
      ) : null}
      {!isGuest && bookmarksQuery.fetchStatus === 'paused' ? (
        <p
          className="rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-strong"
          role="status"
        >
          {t('bookmark.loadOffline')}
        </p>
      ) : !isGuest && bookmarksQuery.isError ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-lg border border-danger-line bg-danger-soft p-4 text-sm font-semibold text-danger"
          role="alert"
        >
          <span>{t('bookmark.loadError')}</span>
          <Button
            variant="outline"
            onClick={() => void bookmarksQuery.refetch()}
          >
            {t('bookmark.retry')}
          </Button>
        </div>
      ) : null}
    </>
  )
}

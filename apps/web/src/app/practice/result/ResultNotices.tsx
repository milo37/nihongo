import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { ResultRetryStatusCode } from '@app/practice/hooks/usePracticeResultController'
import { Button } from '@nihongo/browser/common/components/Button'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { AccountRestrictedNotice } from '@common/components/AccountRestrictedNotice'
import { WarningNotice } from '@app/practice/result/WarningNotice'

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
    <div className="study-result-stale" role={isError ? 'alert' : 'status'}>
      <p className="study-notice-title">
        {t(isPaused ? 'error.cachedOffline' : 'error.staleDescription')}
      </p>
      {isError ? (
        <Button
          className="study-notice-action"
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
  isRetryAccountRestricted: boolean
  incorrectCount: number
  isRetryPaused: boolean
  retryMessage: ResultRetryStatusCode | null
}

export const ResultRetryNotice = ({
  canRequestCanonicalRetry,
  hasNoEligibleRetry,
  hasRetryRequestError,
  isRetryAccountRestricted,
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
        className="study-result-no-retry"
        title={t('retry.noEligibleTitle')}
        description={t('retry.noEligibleDescription')}
        action={newPracticeLink}
      />
    )
  }
  if (incorrectCount > 0 && !canRequestCanonicalRetry) {
    return <WarningNotice spaced>{t('retry.unsupported')}</WarningNotice>
  }
  // All correct: no notice; [다음 10문제] alone is the way on (subtract table 10).
  if (incorrectCount === 0) return null
  if (isRetryPaused) {
    return (
      <WarningNotice spaced live>
        {t('retry.offline')}
      </WarningNotice>
    )
  }
  if (isRetryAccountRestricted) {
    return (
      <AccountRestrictedNotice
        className="study-result-restricted"
        focusOnMount
      />
    )
  }
  if (hasRetryRequestError) {
    return (
      <div className="study-result-retry-error" role="alert">
        <p className="study-result-retry-error-title">
          {t('retry.errorTitle')}
        </p>
        <p className="study-result-retry-error-text">
          {t('retry.errorDescription')}
        </p>
      </div>
    )
  }
  if (retryMessage) {
    return (
      <WarningNotice spaced live>
        {t(`retry.${retryMessage}`)}
      </WarningNotice>
    )
  }
  return null
}

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { ResultRetryStatusCode } from '@app/practice/hooks/usePracticeResultController'
import { Button } from '@nihongo/browser/common/components/Button'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { useErrorToast } from '@common/hooks/useErrorToast'
import { AccountRestrictedNotice } from '@common/components/AccountRestrictedNotice'
import { WarningNotice } from '@app/practice/result/WarningNotice'

type ResultSourceNoticeProps = {
  isError: boolean
  onRetry: () => void
}

// #1262: offline is the one connection toast; results that could not be
// refreshed are a toast that stays, with the retry in it.
export const ResultSourceNotice = ({
  isError,
  onRetry
}: ResultSourceNoticeProps): null => {
  const { t } = useTranslation('result')
  const { t: commonT } = useTranslation('common')
  const { addToast, dismissToast } = useToast()
  const retryRef = useRef(onRetry)
  retryRef.current = onRetry
  useEffect(() => {
    if (!isError) return
    const id = addToast({
      key: 'result-stale',
      title: t('error.staleDescription'),
      variant: 'warning',
      persistent: true,
      action: {
        label: commonT('actions.retry'),
        onClick: () => retryRef.current()
      }
    })
    return () => dismissToast(id)
  }, [isError, addToast, dismissToast, t, commonT])
  return null
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
  useErrorToast(
    hasRetryRequestError ? t('retry.errorTitle') : null,
    'set-create'
  )
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
  if (retryMessage) {
    return (
      <WarningNotice spaced live>
        {t(`retry.${retryMessage}`)}
      </WarningNotice>
    )
  }
  return null
}

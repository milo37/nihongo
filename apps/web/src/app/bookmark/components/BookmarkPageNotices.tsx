import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { AppErrorReportButton } from '@app/question-report/components/AppErrorReportDialog'

type BookmarkListNoticesProps = {
  isCachedOffline: boolean
  isStaleError: boolean
  mutationStatus: string | null
  onRetry: () => void
}

export const BookmarkListNotices = ({
  isCachedOffline,
  isStaleError,
  mutationStatus,
  onRetry
}: BookmarkListNoticesProps): ReactElement => {
  const { t } = useTranslation('bookmark')
  const { t: commonT } = useTranslation('common')
  // #1262: a list that could not be refreshed is a toast that stays, with
  // the retry in it.
  const { addToast, dismissToast } = useToast()
  const retryRef = useRef(onRetry)
  retryRef.current = onRetry
  useEffect(() => {
    if (!isStaleError) return
    const id = addToast({
      key: 'bookmark-stale',
      title: t('error.staleDescription'),
      variant: 'warning',
      persistent: true,
      action: {
        label: commonT('actions.retry'),
        onClick: () => retryRef.current()
      }
    })
    return () => dismissToast(id)
  }, [isStaleError, addToast, dismissToast, t, commonT])
  return (
    <>
      {mutationStatus ? (
        <p className="bookmark-warn" role="status" aria-live="polite">
          {mutationStatus}
        </p>
      ) : null}
      {isCachedOffline ? (
        <p className="bookmark-warn" role="status">
          {t('error.cachedOffline')}
        </p>
      ) : null}
    </>
  )
}

/** No list could be read: offline with nothing kept, or a failed read. */
export const BookmarkLoadError = ({
  isOffline,
  onRetry
}: {
  isOffline: boolean
  onRetry: () => void
}): ReactElement => {
  // Left uncompiled: only the compiled page renders it, once (#1124 bundle).
  'use no memo'
  const { t } = useTranslation('bookmark')
  const { t: commonT } = useTranslation('common')
  if (isOffline) {
    return (
      <ErrorState
        autoFocus
        headingLevel={1}
        title={t('error.offlineTitle')}
        description={t('error.offlineDescription')}
      />
    )
  }
  return (
    <ErrorState
      autoFocus
      headingLevel={1}
      title={t('error.title')}
      description={t('error.description')}
      action={
        <div className="bookmark-error-actions">
          <Button onClick={onRetry}>{commonT('actions.retry')}</Button>
          <AppErrorReportButton />
        </div>
      }
    />
  )
}

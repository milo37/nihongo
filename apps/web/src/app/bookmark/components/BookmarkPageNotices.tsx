import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Button } from '@nihongo/browser/common/components/Button'
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
  return (
    <>
      {mutationStatus ? (
        <p
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
          aria-live="polite"
        >
          {mutationStatus}
        </p>
      ) : null}
      {isCachedOffline ? (
        <p
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
        >
          {t('error.cachedOffline')}
        </p>
      ) : null}
      {isStaleError ? (
        <div
          className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          <p className="font-semibold">{t('error.staleDescription')}</p>
          <Button className="mt-3" size="sm" onClick={onRetry}>
            {commonT('actions.retry')}
          </Button>
        </div>
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
        <div className="flex flex-wrap gap-2">
          <Button onClick={onRetry}>{commonT('actions.retry')}</Button>
          <AppErrorReportButton />
        </div>
      }
    />
  )
}

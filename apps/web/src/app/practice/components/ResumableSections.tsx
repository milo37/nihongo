import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import type { useListResumableStudySessions } from '@app/practice/hooks/useListResumableStudySessions'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'

export type ResumableQuery = ReturnType<typeof useListResumableStudySessions>
type ResumableSession = NonNullable<ResumableQuery['data']>['items'][number]

type ResumableRecordProps = {
  item: ResumableSession
  interactionLocked: boolean
  onCancel: (sessionId: string) => void
}

export const ResumableRecord = ({
  item,
  interactionLocked,
  onCancel
}: ResumableRecordProps): ReactElement => {
  const { i18n, t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const canResume =
    item.practiceContractVersion === 2 && item.resumeAvailability === 'SERVER'

  return (
    <div className="practice-recent-record">
      <div className="practice-resume-info">
        {/* On a narrow phone the text wraps between level and subject, never
            inside the subject (JLP-872). */}
        <h3>
          {item.level}{' '}
          <span className="whitespace-nowrap">
            {commonT(`taxonomy.subjects.${item.subject}`)}
          </span>
        </h3>
        <p className="practice-resume-progress">
          {t('setup.resume.summary', {
            formattedCount: formatNumber(item.actualCount, locale),
            formattedOrdinal: formatNumber(item.currentOrdinal ?? 1, locale)
          })}
        </p>
        {item.resumeAvailability === 'LEGACY_LOCAL_ONLY' && !canResume ? (
          <p className="practice-resume-warning">
            {t('setup.resume.legacyUnavailable')}
          </p>
        ) : null}
      </div>
      <div className="practice-resume-actions">
        {canResume ? (
          <>
            {/* JLP-872: an outline button, so the start button stays the
                only filled one on the screen. */}
            <Link
              className={getButtonClassName({ variant: 'outline' })}
              to={`/practice/session/${item.id}`}
            >
              {t('setup.resume.action')}
            </Link>
            <Button
              className="practice-resume-cancel"
              size="sm"
              variant="ghost"
              disabled={interactionLocked}
              onClick={() => onCancel(item.id)}
            >
              {t('setup.resume.cancel')}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}

/** Inline failure with a retry button; `description` says what failed. */
export const ResumableError = ({
  query,
  description
}: {
  query: ResumableQuery
  description: string
}): ReactElement => {
  const { t: commonT } = useTranslation('common')
  return (
    <ErrorState
      density="inline"
      title={commonT('state.requestFailed')}
      description={description}
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          {commonT('actions.retry')}
        </Button>
      }
    />
  )
}

/** Refresh, stale-cache and failed-refresh notices shown above the list. */
export const ResumableStatusNotices = ({
  query,
  sourceUnavailable
}: {
  query: ResumableQuery
  sourceUnavailable: boolean
}): ReactElement => {
  const { t } = useTranslation('practice')
  const data = query.data
  return (
    <>
      {query.isFetching && !query.isPending ? (
        <LoadingState
          className="practice-resume-status"
          density="inline"
          message={t('setup.resume.refreshing')}
        />
      ) : null}
      {data && sourceUnavailable && !query.isError ? (
        <div
          className="practice-resume-warning"
          role={query.isError ? 'alert' : 'status'}
        >
          <p>
            {t(
              query.fetchStatus === 'paused'
                ? 'setup.resume.cachedOffline'
                : 'setup.resume.stale'
            )}
          </p>
        </div>
      ) : null}
      {data && query.isError ? (
        <ResumableError query={query} description={t('setup.resume.stale')} />
      ) : null}
    </>
  )
}

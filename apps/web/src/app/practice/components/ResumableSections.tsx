import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { useToast } from '@nihongo/browser/common/components/Toast'
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
          <span className="practice-resume-subject">
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

/**
 * #1262: a failed load is a toast, not a box in the list. With no list to
 * show it stays, with the retry in it; a failed refresh just says so.
 */
export const ResumableError = ({
  query,
  description,
  withRetry = false
}: {
  query: ResumableQuery
  description: string
  withRetry?: boolean
}): null => {
  const { t: commonT } = useTranslation('common')
  const { addToast, dismissToast } = useToast()
  const refetchRef = useRef(query.refetch)
  useEffect(() => {
    refetchRef.current = query.refetch
  }, [query.refetch])
  useEffect(() => {
    const id = addToast({
      key: 'resume',
      title: description,
      variant: 'warning',
      ...(withRetry
        ? {
            persistent: true,
            action: {
              label: commonT('actions.retry'),
              onClick: () => void refetchRef.current()
            }
          }
        : {})
    })
    return withRetry ? () => dismissToast(id) : undefined
  }, [refetchRef, description, withRetry, addToast, dismissToast, commonT])
  return null
}

/** Refresh, stale-cache and failed-refresh notices shown above the list. */
export const ResumableStatusNotices = ({
  query
}: {
  query: ResumableQuery
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
      {data && query.isError ? (
        <ResumableError query={query} description={t('setup.resume.stale')} />
      ) : null}
    </>
  )
}

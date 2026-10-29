import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import {
  Button,
  getButtonClassName
} from '@nihongo/browser/common/components/Button'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Pagination } from '@nihongo/browser/common/components/Pagination'
import type { useListResumableStudySessions } from '@app/practice/hooks/useListResumableStudySessions'
import {
  formatDateTime,
  formatNumber
} from '@nihongo/browser/libs/localeFormatters'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'

type ResumableQuery = ReturnType<typeof useListResumableStudySessions>
type ResumableSession = NonNullable<ResumableQuery['data']>['items'][number]

type ResumablePracticeProps = {
  query: ResumableQuery
  canLoad: boolean
  requestedPage: number
  pageCount: number
  sourceUnavailable: boolean
  interactionLocked: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
  getPageHref: (page: number) => string
  onPageChange: (page: number) => void
  onCancel: (sessionId: string) => void
}

type ResumableRecordProps = {
  item: ResumableSession
  recent?: boolean
  interactionLocked: boolean
  onCancel: (sessionId: string) => void
}

const ResumableRecord = ({
  item,
  recent = false,
  interactionLocked,
  onCancel
}: ResumableRecordProps): ReactElement => {
  const { i18n, t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const canResume =
    item.practiceContractVersion === 2 && item.resumeAvailability === 'SERVER'

  return (
    <div
      className={recent ? 'practice-recent-record' : 'practice-resume-record'}
    >
      <div className="practice-resume-info">
        <h3>
          {item.level} {commonT(`taxonomy.subjects.${item.subject}`)}
        </h3>
        <p className="practice-resume-progress">
          {t('setup.resume.summary', {
            formattedCount: formatNumber(item.actualCount, locale),
            formattedOrdinal: formatNumber(item.currentOrdinal ?? 1, locale)
          })}
        </p>
        <p className="practice-resume-context">
          {t(`setup.modes.${item.mode}.label`)} ·{' '}
          {item.draftSavedAt
            ? t('setup.resume.lastSaved', {
                date: formatDateTime(item.draftSavedAt, locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short'
                })
              })
            : t('setup.resume.notSaved')}
        </p>
        {item.resumeAvailability === 'LEGACY_LOCAL_ONLY' && !canResume ? (
          <p className="practice-resume-warning">
            {t('setup.resume.legacyUnavailable')}
          </p>
        ) : null}
      </div>
      <div className="practice-resume-actions">
        {canResume ? (
          <Link
            className={getButtonClassName({
              variant: recent ? 'primary' : 'outline'
            })}
            to={`/practice/session/${item.id}`}
          >
            {t('setup.resume.action')}
            <Icon name="arrow-right" />
          </Link>
        ) : null}
        {canResume ? (
          <Button
            className="practice-resume-cancel"
            size="sm"
            variant="ghost"
            disabled={interactionLocked}
            onClick={() => onCancel(item.id)}
          >
            {t('setup.resume.cancel')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export const ResumablePractice = ({
  query,
  canLoad,
  requestedPage,
  pageCount,
  sourceUnavailable,
  interactionLocked,
  headingRef,
  getPageHref,
  onPageChange,
  onCancel
}: ResumablePracticeProps): ReactElement | null => {
  const { t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const [showOthers, setShowOthers] = useState(false)
  const otherHeadingRef = useRef<HTMLHeadingElement>(null)
  const data = query.data
  const confirmedFirstPage =
    requestedPage === 1 && data?.page === 1 && !query.isPlaceholderData
  const recent = confirmedFirstPage ? data?.items[0] : undefined
  const otherItems = recent ? (data?.items.slice(1) ?? []) : (data?.items ?? [])
  const listVisible = showOthers || !confirmedFirstPage
  const confirmedEmpty =
    query.isSuccess &&
    data?.total === 0 &&
    !query.isPlaceholderData &&
    !sourceUnavailable &&
    !query.isFetching

  if (!canLoad || confirmedEmpty) return null

  return (
    <section
      className="practice-resumable"
      aria-labelledby="resumable-practice-title"
    >
      <h2
        ref={headingRef}
        id="resumable-practice-title"
        className={
          data?.items.length
            ? 'practice-resume-heading sr-only focus:not-sr-only'
            : 'practice-resume-heading'
        }
        tabIndex={-1}
      >
        {t('setup.resume.title')}
      </h2>

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
        <ErrorState
          density="inline"
          title={commonT('state.requestFailed')}
          description={t('setup.resume.stale')}
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
      ) : null}

      {query.isPending ? (
        query.fetchStatus === 'paused' ? (
          <p className="practice-resume-status" role="status">
            {t('setup.resume.offline')}
          </p>
        ) : (
          <LoadingState
            className="practice-resume-status"
            density="inline"
            message={t('setup.resume.loading')}
          />
        )
      ) : query.isError && !data ? (
        <ErrorState
          density="inline"
          title={commonT('state.requestFailed')}
          description={t('setup.resume.error')}
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
      ) : (
        <>
          {recent ? (
            <div
              className={`practice-recent${data?.total === 1 ? ' practice-recent-single' : ''}`}
            >
              <ResumableRecord
                item={recent}
                recent
                interactionLocked={interactionLocked}
                onCancel={onCancel}
              />
              {data && data.total > 1 ? (
                <Button
                  className="practice-other-toggle"
                  variant="ghost"
                  aria-expanded={showOthers}
                  aria-controls="other-resumable-practices"
                  onClick={() => {
                    setShowOthers(!showOthers)
                    if (!showOthers) {
                      window.setTimeout(
                        () => otherHeadingRef.current?.focus(),
                        0
                      )
                    }
                  }}
                >
                  {t('setup.resume.otherAction')}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div
            className="practice-other-sessions"
            id="other-resumable-practices"
            hidden={!listVisible}
          >
            <h3 ref={otherHeadingRef} tabIndex={-1}>
              {t('setup.resume.otherTitle')}
            </h3>
            <ul aria-busy={query.isFetching}>
              {otherItems.map((item) => (
                <li key={item.id}>
                  <ResumableRecord
                    item={item}
                    interactionLocked={interactionLocked}
                    onCancel={onCancel}
                  />
                </li>
              ))}
            </ul>
            {data && data.total > 1 ? (
              <Pagination
                currentPage={data.page}
                requestedPage={requestedPage}
                disabled={interactionLocked}
                getPageHref={getPageHref}
                label={t('setup.resume.paginationLabel')}
                totalPages={pageCount}
                onPageChange={onPageChange}
              />
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}

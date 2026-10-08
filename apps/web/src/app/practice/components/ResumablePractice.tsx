import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import { Button } from '@common/components/Button'
import { Pagination } from '@common/components/Pagination'
import type { useListResumableStudySessions } from '@app/practice/hooks/useListResumableStudySessions'
import { formatDateTime, formatNumber } from '@libs/localeFormatters'
import { resolveUiLocale } from '@/i18n/types'

type ResumableQuery = ReturnType<typeof useListResumableStudySessions>
type ResumableSession = NonNullable<ResumableQuery['data']>['items'][number]

type ResumablePracticeProps = {
  query: ResumableQuery
  canLoad: boolean
  storedSessionId: string | null
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
  storedSessionId: string | null
  interactionLocked: boolean
  onCancel: (sessionId: string) => void
}

const ResumableRecord = ({
  item,
  recent = false,
  storedSessionId,
  interactionLocked,
  onCancel
}: ResumableRecordProps): ReactElement => {
  const { i18n, t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const canResume =
    item.resumeAvailability === 'SERVER' || storedSessionId === item.id

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
            className="practice-resume-link"
            to={`/practice/session/${item.id}`}
          >
            {t('setup.resume.action')}
          </Link>
        ) : null}
        <Button
          className="practice-resume-cancel"
          size="sm"
          variant="ghost"
          disabled={interactionLocked}
          onClick={() => onCancel(item.id)}
        >
          {t('setup.resume.cancel')}
        </Button>
      </div>
    </div>
  )
}

export const ResumablePractice = ({
  query,
  canLoad,
  storedSessionId,
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
        <p className="practice-resume-status" role="status" aria-atomic="true">
          {t('setup.resume.refreshing')}
        </p>
      ) : null}
      {data && sourceUnavailable ? (
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
          {query.isError ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void query.refetch()}
            >
              {commonT('actions.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {query.isPending ? (
        <p className="practice-resume-status" role="status">
          {t(
            query.fetchStatus === 'paused'
              ? 'setup.resume.offline'
              : 'setup.resume.loading'
          )}
        </p>
      ) : query.isError && !data ? (
        <div className="practice-resume-warning" role="alert">
          <p>{t('setup.resume.error')}</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void query.refetch()}
          >
            {commonT('actions.retry')}
          </Button>
        </div>
      ) : (
        <>
          {recent ? (
            <div
              className={`practice-recent${data?.total === 1 ? ' practice-recent-single' : ''}`}
            >
              <ResumableRecord
                item={recent}
                recent
                storedSessionId={storedSessionId}
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
                    storedSessionId={storedSessionId}
                    interactionLocked={interactionLocked}
                    onCancel={onCancel}
                  />
                </li>
              ))}
            </ul>
            {data && data.total > data.pageSize ? (
              <Pagination
                currentPage={data.page}
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

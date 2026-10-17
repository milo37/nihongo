import { useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useAdminReportList } from '@app/admin-report/hooks/useAdminReportQueries'
import {
  parseReportListSearch,
  reportListHref
} from '@app/admin-report/navigation/reportListContext'
import { ReportListFilters } from '@app/admin-report/components/ReportListFilters'
import { ReportListRow } from '@app/admin-report/components/ReportListRow'
import { Select } from '@common/components/Select'
import { LoadingState } from '@common/components/LoadingState'
import { ErrorState } from '@common/components/ErrorState'
import { EmptyState } from '@common/components/EmptyState'
import { Pagination } from '@common/components/Pagination'
export const ReportList = (): ReactElement => {
  const { t, formatAdminNumber, presentError } = useAdminPresentation()
  const { t: labels } = useTranslation('adminReports')
  const [search, setSearch] = useSearchParams()
  const navigate = useNavigate()
  const { query, valid } = parseReportListSearch(search)
  const reports = useAdminReportList(query, valid)
  const paused = reports.isOffline || reports.fetchStatus === 'paused'
  const data = reports.data
  const settled =
    valid &&
    reports.isSuccess &&
    !reports.isPlaceholderData &&
    !reports.isFetching &&
    !paused
  const lastPage = Math.max(1, Math.ceil((data?.total ?? 0) / 20))
  const listRef = useRef<HTMLUListElement>(null)
  const focusedReturn = useRef<string | null>(null)
  useEffect(() => {
    if (settled && query.page > lastPage)
      setSearch(
        new URLSearchParams(
          reportListHref(
            { ...query, page: lastPage },
            search.get('focusReport') ?? undefined
          ).split('?')[1]
        ),
        { replace: true }
      )
  }, [settled, query, lastPage, setSearch, search])
  useEffect(() => {
    const reportId = search.get('focusReport')
    const focusKey = search.toString()
    if (
      !settled ||
      !reportId ||
      focusedReturn.current === focusKey ||
      query.page !== data?.page
    )
      return
    const row = Array.from(
      listRef.current?.querySelectorAll<HTMLAnchorElement>(
        '[data-report-id]'
      ) ?? []
    ).find((link) => link.dataset.reportId === reportId)
    if (row) {
      focusedReturn.current = focusKey
      row.focus({ preventScroll: true })
      row.scrollIntoView?.({ block: 'nearest' })
    }
  }, [settled, search, query.page, data?.page])
  const stale = reports.isError || paused
  return (
    <section className="admin-report-page">
      <nav
        className="admin-report-navigation"
        aria-label={labels('navigation')}
      >
        <div className="admin-report-desktop-navigation">
          <Link to="/admin/questions">{t('common.questions')}</Link>
          <Link to="/admin/reports" aria-current="page">
            {t('common.reports')}
          </Link>
        </div>
        <div className="admin-report-mobile-navigation">
          <Select
            name="report-management-menu"
            label={labels('navigation')}
            hideLabel
            value="/admin/reports"
            options={[
              { value: '/admin/questions', label: t('common.questions') },
              { value: '/admin/reports', label: t('common.reports') }
            ]}
            onChange={(event) => void navigate(event.currentTarget.value)}
          />
        </div>
      </nav>
      <header className="admin-report-heading">
        <h1>{labels('title')}</h1>
        <p>{labels('description')}</p>
      </header>
      <ReportListFilters
        key={JSON.stringify(
          [
            'questionId',
            'assigneeActorId',
            'createdFrom',
            'createdTo',
            'updatedFrom',
            'updatedTo'
          ].map((key) => search.get(key))
        )}
        search={search}
        query={query}
        onChange={setSearch}
      />
      {!valid ? (
        <ErrorState description={t('reportList.invalidQuery')} />
      ) : null}
      {valid && stale ? (
        <ErrorState
          title={paused ? t('common.pausedTitle') : t('reportList.error')}
          description={
            paused
              ? t(
                  data
                    ? 'common.cachedPausedDescription'
                    : 'common.pausedDescription'
                )
              : data
                ? t('reportList.cachedError')
                : presentError(reports.error)
          }
          onRetry={() => void reports.refetch()}
          retryLabel={t('reportList.retry')}
          density={data ? 'inline' : 'regular'}
        />
      ) : null}
      {valid && reports.isPending && !data && !paused ? (
        <LoadingState message={t('reportList.loading')} />
      ) : null}
      {valid && data ? (
        <>
          <div className="admin-report-list-summary" aria-live="polite">
            <strong>
              {labels('count', {
                formattedCount: formatAdminNumber(data.total)
              })}
            </strong>
            {reports.isFetching || reports.isPlaceholderData ? (
              <LoadingState
                density="inline"
                message={t('reportList.refreshing')}
              />
            ) : null}
          </div>
          {data.items.length === 0 && settled ? (
            <EmptyState
              title={t('reportList.emptyTitle')}
              description={t('reportList.emptyDescription')}
            />
          ) : null}
          <ul
            className="admin-report-list"
            ref={listRef}
            aria-busy={reports.isFetching}
          >
            {data.items.map((report) => (
              <ReportListRow
                key={report.id}
                report={report}
                navigationEnabled={!reports.isPlaceholderData}
                query={{ ...query, page: data.page }}
              />
            ))}
          </ul>
          <Pagination
            currentPage={data.page}
            requestedPage={query.page}
            totalPages={lastPage}
            disabled={stale || reports.isFetching || reports.isPlaceholderData}
            onPageChange={(page) =>
              setSearch(
                new URLSearchParams(
                  reportListHref({ ...query, page }).split('?')[1]
                )
              )
            }
            getPageHref={(page) => reportListHref({ ...query, page })}
          />
        </>
      ) : null}
    </section>
  )
}

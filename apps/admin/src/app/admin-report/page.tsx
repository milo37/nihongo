import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  reportKindSchema,
  reportStatusSchema
} from '@nihongo/contracts/report/reports'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { AdminListSkeleton } from '@app/admin/components/list/AdminListSkeleton'
import { AdminListFilters } from '@app/admin/components/list/AdminListFilters'
import {
  AdminListToolbar,
  type AdminListPaging
} from '@app/admin/components/list/AdminListToolbar'
import type { AdminListFilter } from '@app/admin/components/list/FilterChip'
import { useWideLayout } from '@app/admin/components/list/useWideLayout'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useAdminReportsList } from '@app/admin-report/hooks/useAdminReportQueries'
import {
  parseReportListSearch,
  reportDetailHref,
  reportListHref,
  reportPageSizes
} from '@app/admin-report/navigation/reportListContext'
import {
  consumeReportListFocus,
  saveReportContext
} from '@app/admin-report/navigation/reportListFocus'
import { ReportStatusBadge } from '@app/admin-report/components/ReportStatusBadge'
import { useReportLocationLabel } from '@app/admin-report/useReportLocationLabel'
import { PageContainer } from '@nihongo/browser/common/components/PageContainer'

type ReportListResult = NonNullable<
  ReturnType<typeof useAdminReportsList>['data']
>
type ReportItem = ReportListResult['items'][number]

/** One report's detail link; blocked while the list is not current. */
const ReportLink = ({
  item,
  blocked,
  onOpen
}: {
  item: ReportItem
  blocked: boolean
  onOpen: (reportId: string) => void
}): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <Link
      id={'report-' + item.reportId}
      to={reportDetailHref(item.reportId)}
      aria-disabled={blocked || undefined}
      tabIndex={blocked ? -1 : undefined}
      onClick={(event) => {
        if (blocked) {
          event.preventDefault()
          return
        }
        onOpen(item.reportId)
      }}
      className={
        'inline-flex min-h-11 items-center whitespace-nowrap font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ' +
        (blocked ? 'cursor-not-allowed text-muted' : 'text-brand')
      }
    >
      {t('userReport.list.details')}
      <span className="sr-only"> · {item.descriptionPreview}</span>
    </Link>
  )
}

const ReportBadges = ({ item }: { item: ReportItem }): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <>
      <ReportStatusBadge status={item.status} />
      <Badge className="whitespace-nowrap">
        {t(`userReport.kinds.${item.kind}`)}
      </Badge>
    </>
  )
}

type ReportListProps = {
  items: readonly ReportItem[]
  blocked: boolean
  onOpen: (reportId: string) => void
}

/** Header row with status·kind, content, location·time and the link. */
const ReportTable = ({
  items,
  blocked,
  onOpen
}: ReportListProps): ReactElement => {
  const { t, formatAdminDateTime } = useAdminPresentation()
  const locationLabel = useReportLocationLabel()
  return (
    <div
      role="region"
      aria-label={t('userReport.list.title')}
      tabIndex={0}
      className="relative overflow-x-auto rounded-card border border-line bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <table className="w-full min-w-[48rem] table-fixed border-collapse text-left text-sm">
        <caption className="sr-only">{t('userReport.list.title')}</caption>
        <thead className="border-b border-line bg-surface-muted text-muted">
          <tr>
            <th scope="col" className="w-[7.5rem] px-3 py-3 font-semibold">
              {t('userReport.list.columns.statusKind')}
            </th>
            <th scope="col" className="px-3 py-3 font-semibold">
              {t('userReport.list.columns.content')}
            </th>
            <th scope="col" className="w-[12.5rem] px-3 py-3 font-semibold">
              {t('userReport.list.columns.locationTime')}
            </th>
            <th scope="col" className="w-[5.5rem] px-3 py-3">
              <span className="sr-only">
                {t('userReport.list.columns.link')}
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((item) => (
            <tr key={item.reportId}>
              <td className="px-3 py-3 align-top">
                <span className="flex flex-col items-start gap-1">
                  <ReportBadges item={item} />
                </span>
              </td>
              <td className="px-3 py-3 align-top">
                <p className="line-clamp-2 break-words font-semibold leading-6">
                  {item.descriptionPreview}
                </p>
              </td>
              <td className="px-3 py-3 align-top">
                <span
                  className="block truncate"
                  title={locationLabel(item.location)}
                >
                  {locationLabel(item.location)}
                </span>
                <span className="block text-muted">
                  {formatAdminDateTime(item.createdAt)}
                </span>
              </td>
              <td className="px-3 py-1 align-top">
                <ReportLink item={item} blocked={blocked} onOpen={onOpen} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Narrow screens: one card per report. */
const ReportCards = ({
  items,
  blocked,
  onOpen
}: ReportListProps): ReactElement => {
  const { t, formatAdminDateTime } = useAdminPresentation()
  const locationLabel = useReportLocationLabel()
  return (
    <ul className="grid gap-2" aria-label={t('userReport.list.title')}>
      {items.map((item) => (
        <li
          key={item.reportId}
          className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-card border border-line bg-surface px-4 py-3"
        >
          <span className="flex flex-wrap gap-2">
            <ReportBadges item={item} />
          </span>
          <p className="line-clamp-2 break-words font-semibold">
            {item.descriptionPreview}
          </p>
          <p className="text-sm text-muted">
            <span className="block truncate">
              {locationLabel(item.location)}
            </span>
            {formatAdminDateTime(item.createdAt)}
          </p>
          <ReportLink item={item} blocked={blocked} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  )
}

export const AdminReportsPage = (): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const { user } = useAuth()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { query, valid } = parseReportListSearch(search)
  const reports = useAdminReportsList(query)
  const heading = useRef<HTMLHeadingElement>(null)
  const listTop = useRef<HTMLDivElement>(null)
  const wide = useWideLayout()
  const [retryCompletion, setRetryCompletion] = useState(0)
  const canonical = reportListHref(query)
  const blocked =
    reports.isPlaceholderData ||
    reports.isFetching ||
    reports.isError ||
    reports.fetchStatus === 'paused' ||
    reports.isOffline
  useEffect(() => {
    if (!user || !reports.isSuccess || blocked) return
    const id = consumeReportListFocus(user.id, canonical)
    if (!id) return
    // Restore the row after AppLayout's initial route focus.
    const frame = window.requestAnimationFrame(() => {
      ;(document.getElementById('report-' + id) ?? heading.current)?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [user, reports.isSuccess, blocked, canonical])
  useEffect(() => {
    if (retryCompletion) heading.current?.focus()
  }, [retryCompletion])
  const retry = (): void => {
    void reports.refetch().then((result) => {
      if (result.isSuccess && result.fetchStatus === 'idle')
        setRetryCompletion((value) => value + 1)
    })
  }
  const go = (next: Parameters<typeof reportListHref>[0]): void => {
    void navigate(reportListHref(next).slice('/admin'.length))
  }
  const data = reports.data
  const unavailable =
    reports.isError || reports.fetchStatus === 'paused' || reports.isOffline
  const paused = reports.fetchStatus === 'paused' || reports.isOffline
  const loading =
    reports.isPending && reports.fetchStatus !== 'paused' && !reports.isOffline
  const filter = (
    key: 'status' | 'kind',
    options: readonly string[],
    labelPrefix: 'statuses' | 'kinds'
  ): AdminListFilter => ({
    key,
    label: t(`userReport.list.${key}`),
    value: query[key],
    options: options.map((value) => ({
      value,
      label: t(`userReport.${labelPrefix}.${value as 'NEW'}`)
    })),
    onChange: (value) => {
      const next = { ...query, page: 1 }
      if (value === undefined) delete next[key]
      else Object.assign(next, { [key]: value })
      go(next)
    }
  })
  const filters = [
    filter('status', reportStatusSchema.options, 'statuses'),
    filter('kind', reportKindSchema.options, 'kinds')
  ]
  const paging: AdminListPaging = {
    total: data?.total,
    page: query.page,
    pageSize: query.pageSize,
    pageSizes: reportPageSizes,
    disabled: blocked,
    onPageChange: (page) => go({ ...query, page }),
    onPageSizeChange: (pageSize) => go({ ...query, page: 1, pageSize })
  }
  const openReport = (reportId: string): void => {
    if (user) saveReportContext(user.id, reportId, canonical)
  }
  return (
    <PageContainer width="6xl">
      <header className="pb-8">
        <h1
          ref={heading}
          tabIndex={-1}
          className="rounded-sm text-balance text-3xl font-black sm:text-4xl"
        >
          {t('userReport.list.title')}
        </h1>
        <p className="mt-4 max-w-prose text-muted">
          {t('userReport.list.description')}
        </p>
      </header>
      {!valid ? (
        <p role="alert" className="mb-4 text-danger">
          {t('userReport.list.invalidQuery')}
        </p>
      ) : null}
      <AdminListFilters
        filters={filters}
        resultCount={data?.total}
        onReset={() => go({ page: 1, pageSize: query.pageSize })}
      />
      <div className="mt-6">
        <AdminListToolbar position="top" paging={paging} anchorRef={listTop} />
      </div>
      {reports.isFetching && data ? (
        <p role="status" className="mt-6 text-muted">
          {t('userReport.list.refreshing')}
        </p>
      ) : null}
      {unavailable ? (
        <ErrorState
          className="mt-6"
          title={t(
            data ? 'userReport.list.cachedError' : 'userReport.list.error'
          )}
          description={
            paused ? t('common.pausedDescription') : presentError(reports.error)
          }
          onRetry={retry}
          retryLabel={t('userReport.list.retry')}
          autoFocus={!data}
        />
      ) : null}
      {data && data.items.length === 0 ? (
        <EmptyState
          title={t('userReport.list.emptyTitle')}
          description={t('userReport.list.emptyDescription')}
        />
      ) : null}
      {data && data.items.length > 0 ? (
        <>
          {wide ? (
            <ReportTable
              items={data.items}
              blocked={blocked}
              onOpen={openReport}
            />
          ) : (
            <ReportCards
              items={data.items}
              blocked={blocked}
              onOpen={openReport}
            />
          )}
          <AdminListToolbar
            position="bottom"
            paging={paging}
            anchorRef={listTop}
          />
        </>
      ) : null}
      {!data && loading ? (
        <div className="mt-8">
          <AdminListSkeleton message={t('userReport.list.loading')} />
        </div>
      ) : null}
    </PageContainer>
  )
}

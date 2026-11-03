import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  reportKindSchema,
  reportStatusSchema
} from '@nihongo/contracts/report/reports'
import { Button } from '@nihongo/browser/common/components/Button'
import { Select } from '@nihongo/browser/common/components/Select'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
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

export const AdminReportsPage = (): ReactElement => {
  const { t, presentError, formatAdminDateTime } = useAdminPresentation()
  const { locale } = useUiLocale()
  const { user } = useAuth()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { query, valid } = parseReportListSearch(search)
  const reports = useAdminReportsList(query)
  const heading = useRef<HTMLHeadingElement>(null)
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
  const apply = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const status = reportStatusSchema.safeParse(data.get('status'))
    const kind = reportKindSchema.safeParse(data.get('kind'))
    const pageSize = Number(data.get('pageSize'))
    go({
      page: 1,
      pageSize: (reportPageSizes as readonly number[]).includes(pageSize)
        ? pageSize
        : query.pageSize,
      ...(status.success ? { status: status.data } : {}),
      ...(kind.success ? { kind: kind.data } : {})
    })
  }
  const data = reports.data
  const lastPage = data
    ? Math.max(1, Math.ceil(data.total / query.pageSize))
    : 1
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
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
      <form
        key={search.toString()}
        className="grid gap-5 rounded-xl border border-line bg-surface p-5 sm:p-6"
        onSubmit={apply}
        noValidate
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <Select
            name="status"
            label={t('userReport.list.status')}
            defaultValue={query.status ?? ''}
            options={[
              { value: '', label: t('userReport.list.allStatuses') },
              ...reportStatusSchema.options.map((value) => ({
                value,
                label: t(`userReport.statuses.${value}`)
              }))
            ]}
          />
          <Select
            name="kind"
            label={t('userReport.list.kind')}
            defaultValue={query.kind ?? ''}
            options={[
              { value: '', label: t('userReport.list.allKinds') },
              ...reportKindSchema.options.map((value) => ({
                value,
                label: t(`userReport.kinds.${value}`)
              }))
            ]}
          />
          <Select
            name="pageSize"
            label={t('userReport.list.pageSize')}
            defaultValue={String(query.pageSize)}
            options={reportPageSizes.map((value) => ({
              value: String(value),
              label: formatNumber(value, locale)
            }))}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit">{t('userReport.list.apply')}</Button>
          <Button variant="ghost" onClick={() => void navigate('/reports')}>
            {t('userReport.list.reset')}
          </Button>
        </div>
      </form>
      {reports.isFetching && data ? (
        <p role="status" className="mt-6 text-muted">
          {t('userReport.list.refreshing')}
        </p>
      ) : null}
      {reports.isError ||
      reports.fetchStatus === 'paused' ||
      reports.isOffline ? (
        <ErrorState
          className="mt-6"
          title={t(
            data ? 'userReport.list.cachedError' : 'userReport.list.error'
          )}
          description={
            reports.fetchStatus === 'paused' || reports.isOffline
              ? t('common.pausedDescription')
              : presentError(reports.error)
          }
          onRetry={retry}
          retryLabel={t('userReport.list.retry')}
          autoFocus={!data}
        />
      ) : null}
      {!data ? (
        reports.isPending &&
        reports.fetchStatus !== 'paused' &&
        !reports.isOffline ? (
          <LoadingState
            className="mt-8"
            message={t('userReport.list.loading')}
          />
        ) : null
      ) : (
        <>
          <p className="mt-8 font-semibold" role="status">
            {t('userReport.list.total', {
              formattedCount: formatNumber(data.total, locale)
            })}
          </p>
          {data.items.length === 0 ? (
            <EmptyState
              className="mt-4"
              title={t('userReport.list.emptyTitle')}
              description={t('userReport.list.emptyDescription')}
            />
          ) : (
            <ul
              className="mt-4 divide-y divide-line border-y border-line"
              aria-label={t('userReport.list.title')}
            >
              {data.items.map((item) => (
                <li
                  key={item.reportId}
                  className="grid min-w-0 gap-3 bg-surface px-4 py-6 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:gap-6"
                >
                  <div className="flex flex-wrap gap-2 sm:flex-col sm:items-start">
                    <ReportStatusBadge status={item.status} />
                    <Badge>{t(`userReport.kinds.${item.kind}`)}</Badge>
                  </div>
                  <div className="min-w-0">
                    <p className="break-words font-semibold">
                      {item.descriptionPreview}
                    </p>
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted">
                          {t('userReport.list.location')}
                        </dt>
                        <dd className="break-all">{item.location}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">
                          {t('userReport.list.createdAt')}
                        </dt>
                        <dd>{formatAdminDateTime(item.createdAt)}</dd>
                      </div>
                    </dl>
                  </div>
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
                      if (user)
                        saveReportContext(user.id, item.reportId, canonical)
                    }}
                    className={
                      'inline-flex min-h-11 items-center self-start font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ' +
                      (blocked ? 'cursor-not-allowed text-muted' : 'text-brand')
                    }
                  >
                    {t('userReport.list.details')}
                    <span className="sr-only">
                      {' '}
                      · {item.descriptionPreview}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {query.page > lastPage ? (
            <Button
              className="mt-6"
              variant="outline"
              disabled={blocked}
              onClick={() => go({ ...query, page: 1 })}
            >
              {t('userReport.list.first')}
            </Button>
          ) : null}
          <nav
            aria-label={t('userReport.list.title')}
            className="mt-8 flex justify-between gap-4"
          >
            <Button
              variant="outline"
              disabled={blocked || query.page <= 1}
              onClick={() => go({ ...query, page: query.page - 1 })}
            >
              {t('userReport.list.previous')}
            </Button>
            <Button
              variant="outline"
              disabled={blocked || query.page >= lastPage}
              onClick={() => go({ ...query, page: query.page + 1 })}
            >
              {t('userReport.list.next')}
            </Button>
          </nav>
        </>
      )}
    </section>
  )
}

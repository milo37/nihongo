import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  questionReportReasonSchema,
  questionReportStatusSchema
} from '@nihongo/contracts/admin/content-operations'
import { Button } from '@nihongo/browser/common/components/Button'
import { Input } from '@nihongo/browser/common/components/Input'
import { Select } from '@nihongo/browser/common/components/Select'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { AdminNavigation } from '@app/admin/components/AdminNavigation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useAdminReportsList } from '@app/admin-report/hooks/useAdminReportQueries'
import {
  parseReportListSearch,
  reportFilterKeys,
  reportListHref,
  reportDetailHref
} from '@app/admin-report/navigation/reportListContext'
import {
  consumeReportListFocus,
  saveReportContext
} from '@app/admin-report/navigation/reportDraftRecovery'

export const AdminReportsPage = (): ReactElement => {
  const { t, presentError, formatAdminDateTime } = useAdminPresentation()
  const { user } = useAuth()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { query, valid } = parseReportListSearch(search)
  const reports = useAdminReportsList(query)
  const heading = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const [invalid, setInvalid] = useState(false)
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
    if (invalid) errorRef.current?.focus()
  }, [invalid])
  useEffect(() => {
    if (retryCompletion) heading.current?.focus()
  }, [retryCompletion])
  const retry = (): void => {
    void reports.refetch().then((result) => {
      if (result.isSuccess && result.fetchStatus === 'idle')
        setRetryCompletion((value) => value + 1)
    })
  }
  const changePage = (page: number): void => {
    void navigate(reportListHref({ ...query, page }).slice('/admin'.length))
  }
  const apply = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const next = new URLSearchParams({ page: '1' })
    for (const key of reportFilterKeys) {
      if (key === 'page' || key === 'pageSize') continue
      const value = String(data.get(key) ?? '').trim()
      if (value) next.set(key, value)
    }
    const parsed = parseReportListSearch(next)
    setInvalid(!parsed.valid)
    if (parsed.valid)
      void navigate(reportListHref(parsed.query).slice('/admin'.length))
  }
  const data = reports.data
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <AdminNavigation />
      <header className="pb-8">
        <h1
          ref={heading}
          tabIndex={-1}
          className="rounded-sm text-balance text-3xl font-black sm:text-4xl"
        >
          {t('reportList.title')}
        </h1>
        <p className="mt-4 max-w-prose text-muted">
          {t('reportDetail.listDescription')}
        </p>
      </header>
      {!valid ? (
        <p role="alert" className="mb-4 text-danger">
          {t('reportList.invalidQuery')}
        </p>
      ) : null}
      <form
        key={search.toString()}
        className="grid gap-5 rounded-xl border border-line bg-surface p-5 sm:p-6"
        onSubmit={apply}
        noValidate
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            name="status"
            label={t('reportList.status')}
            defaultValue={query.status ?? ''}
            options={[
              { value: '', label: t('reportList.allStatuses') },
              ...questionReportStatusSchema.options.map((value) => ({
                value,
                label: t(`enums.reportStatuses.${value}`)
              }))
            ]}
          />
          <Select
            name="reason"
            label={t('reportList.reason')}
            defaultValue={query.reason ?? ''}
            options={[
              { value: '', label: t('reportList.allReasons') },
              ...questionReportReasonSchema.options.map((value) => ({
                value,
                label: t(`enums.reportReasons.${value}`)
              }))
            ]}
          />
          <Input
            name="questionId"
            label={t('reportList.questionId')}
            defaultValue={query.questionId ?? ''}
          />
          <Select
            name="sort"
            label={t('reportList.sort')}
            defaultValue={query.sort}
            options={(['UPDATED_DESC', 'CREATED_DESC'] as const).map(
              (value) => ({ value, label: t(`enums.reportSort.${value}`) })
            )}
          />
        </div>
        <details>
          <summary className="min-h-11 cursor-pointer py-3 font-semibold text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
            {t('reportDetail.advancedFilters')}
          </summary>
          <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2">
            {(
              [
                'assigneeActorId',
                'createdFrom',
                'createdTo',
                'updatedFrom',
                'updatedTo'
              ] as const
            ).map((key) => (
              <Input
                key={key}
                name={key}
                label={t(`reportList.${key}`)}
                defaultValue={query[key] ?? ''}
                hint={
                  key === 'assigneeActorId'
                    ? undefined
                    : t('reportDetail.dateHint')
                }
              />
            ))}
          </div>
        </details>
        {invalid ? (
          <p ref={errorRef} role="alert" tabIndex={-1} className="text-danger">
            {t('errors.fieldInvalid')}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit">{t('reportDetail.applyFilters')}</Button>
          <Button
            variant="ghost"
            onClick={() => {
              setInvalid(false)
              void navigate('/reports')
            }}
          >
            {t('reportList.resetFilters')}
          </Button>
        </div>
      </form>
      {reports.isFetching && data ? (
        <p role="status" className="mt-6 text-muted">
          {t('reportList.refreshing')}
        </p>
      ) : null}
      {reports.isError ||
      reports.fetchStatus === 'paused' ||
      reports.isOffline ? (
        <ErrorState
          className="mt-6"
          title={t(data ? 'reportList.cachedError' : 'reportList.error')}
          description={
            reports.fetchStatus === 'paused' || reports.isOffline
              ? t('common.pausedDescription')
              : presentError(reports.error)
          }
          onRetry={retry}
          retryLabel={t('reportList.retry')}
          autoFocus={!data}
        />
      ) : null}
      {!data ? (
        reports.isPending &&
        reports.fetchStatus !== 'paused' &&
        !reports.isOffline ? (
          <LoadingState className="mt-8" message={t('reportList.loading')} />
        ) : null
      ) : (
        <>
          <p className="mt-8 font-semibold" role="status">
            {t('reportDetail.total', { count: data.total })}
          </p>
          {data.items.length === 0 ? (
            <EmptyState
              className="mt-4"
              title={t('reportList.emptyTitle')}
              description={t('reportList.emptyDescription')}
            />
          ) : (
            <ul
              className="mt-4 divide-y divide-line border-y border-line"
              aria-label={t('reportList.title')}
            >
              {data.items.map((item) => (
                <li
                  key={item.id}
                  className="grid min-w-0 gap-3 bg-surface px-4 py-6 sm:grid-cols-[auto_1fr_auto] sm:gap-6"
                >
                  <div>
                    <Badge>{t(`enums.reportStatuses.${item.status}`)}</Badge>
                  </div>
                  <div className="min-w-0">
                    <strong>{t(`enums.reportReasons.${item.reason}`)}</strong>
                    <p className="mt-3 break-all text-sm text-muted">
                      {t('common.question')}: {item.questionId}
                    </p>
                    <details className="mt-3 text-sm">
                      <summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                        {t('reportDetail.rowInfo')}
                      </summary>
                      <dl className="mt-2 grid gap-3 sm:grid-cols-2">
                        <div>
                          <dt className="text-muted">{t('common.reporter')}</dt>
                          <dd className="break-all">{item.reporter.actorId}</dd>
                        </div>
                        <div>
                          <dt className="text-muted">{t('common.assignee')}</dt>
                          <dd className="break-all">
                            {item.assignee?.actorId ?? t('common.unassigned')}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">
                            {t('common.createdAt')}
                          </dt>
                          <dd>{formatAdminDateTime(item.createdAt)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted">
                            {t('common.updatedAt')}
                          </dt>
                          <dd>{formatAdminDateTime(item.updatedAt)}</dd>
                        </div>
                      </dl>
                    </details>
                  </div>
                  <Link
                    id={'report-' + item.id}
                    to={reportDetailHref(item.id)}
                    aria-disabled={blocked || undefined}
                    tabIndex={blocked ? -1 : undefined}
                    onClick={(event) => {
                      if (blocked) {
                        event.preventDefault()
                        return
                      }
                      if (user) saveReportContext(user.id, item.id, canonical)
                    }}
                    onAuxClick={(event) => {
                      if (blocked) event.preventDefault()
                    }}
                    onContextMenu={(event) => {
                      if (blocked) event.preventDefault()
                    }}
                    className={
                      'inline-flex min-h-11 items-center self-start font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ' +
                      (blocked ? 'cursor-not-allowed text-muted' : 'text-brand')
                    }
                  >
                    {t('common.details')}
                    <span className="sr-only"> · {item.id}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data.page > 1 && data.items.length === 0 ? (
            <Button
              className="mt-6"
              variant="outline"
              disabled={blocked}
              onClick={() => changePage(1)}
            >
              {t('reportDetail.first')}
            </Button>
          ) : null}
          <nav
            aria-label={t('common.reports')}
            className="mt-8 flex justify-between gap-4"
          >
            <Button
              variant="outline"
              disabled={blocked || query.page <= 1}
              onClick={() => changePage(query.page - 1)}
            >
              {t('reportDetail.previous')}
            </Button>
            <Button
              variant="outline"
              disabled={blocked || query.page >= Math.ceil(data.total / 20)}
              onClick={() => changePage(query.page + 1)}
            >
              {t('reportDetail.next')}
            </Button>
          </nav>
        </>
      )}
    </section>
  )
}

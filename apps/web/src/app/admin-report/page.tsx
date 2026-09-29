import { useCallback, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { FormEvent, ReactElement } from 'react'
import {
  listAdminQuestionReportsQuerySchema,
  type ListAdminQuestionReportsQuery
} from '@nihongo/contracts/admin/phase7'
import {
  adminActorLabelKey,
  adminReportReasonKey,
  adminReportSortKey,
  adminReportStatusKey
} from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { usePhase7AdminQuestionReportList } from '@app/admin-question/hooks/usePhase7AdminQueries'
import { Badge } from '@common/components/Badge'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { Button } from '@common/components/Button'
import { Input } from '@common/components/Input'
import { LoadingState } from '@common/components/LoadingState'
import { Pagination } from '@common/components/Pagination'
import { Select } from '@common/components/Select'
import { Table, TableSortHeader } from '@common/components/Table'

const statuses = ['OPEN', 'TRIAGED', 'RESOLVED', 'DISMISSED'] as const
const reasons = [
  'ANSWER_ERROR',
  'EXPLANATION_ERROR',
  'TYPO_OR_GRAMMAR',
  'AMBIGUOUS',
  'LEVEL_OR_TAXONOMY',
  'OTHER'
] as const
const sorts = ['UPDATED_DESC', 'CREATED_DESC'] as const

const asMember = <Value extends string>(
  value: string | null,
  values: readonly Value[]
): Value | undefined =>
  value !== null && values.includes(value as Value)
    ? (value as Value)
    : undefined

interface ParsedAdminQuestionReportSearch {
  readonly error?: 'INVALID_QUERY'
  readonly query: ListAdminQuestionReportsQuery
}

export const parseAdminQuestionReportSearch = (
  searchParams: URLSearchParams
): ParsedAdminQuestionReportSearch => {
  const optionalText = (key: string): string | undefined => {
    const value = searchParams.get(key)?.trim()
    return value ? value : undefined
  }
  const rawPage = searchParams.get('page')
  const parsedPage = rawPage === null ? 1 : Number(rawPage)
  const hasValidPage = Number.isSafeInteger(parsedPage) && parsedPage > 0
  const candidate = {
    page: hasValidPage ? parsedPage : 1,
    pageSize: 20,
    sort: asMember(searchParams.get('sort'), sorts) ?? 'UPDATED_DESC',
    ...(asMember(searchParams.get('status'), statuses)
      ? { status: asMember(searchParams.get('status'), statuses) }
      : {}),
    ...(asMember(searchParams.get('reason'), reasons)
      ? { reason: asMember(searchParams.get('reason'), reasons) }
      : {}),
    ...(optionalText('questionId')
      ? { questionId: optionalText('questionId') }
      : {}),
    ...(optionalText('assigneeActorId')
      ? { assigneeActorId: optionalText('assigneeActorId') }
      : {}),
    ...(optionalText('createdFrom')
      ? { createdFrom: optionalText('createdFrom') }
      : {}),
    ...(optionalText('createdTo')
      ? { createdTo: optionalText('createdTo') }
      : {}),
    ...(optionalText('updatedFrom')
      ? { updatedFrom: optionalText('updatedFrom') }
      : {}),
    ...(optionalText('updatedTo')
      ? { updatedTo: optionalText('updatedTo') }
      : {})
  }
  const parsed = listAdminQuestionReportsQuerySchema.safeParse(candidate)
  if (hasValidPage && parsed.success) return { query: parsed.data }
  return {
    error: 'INVALID_QUERY',
    query: { page: 1, pageSize: 20, sort: 'UPDATED_DESC' }
  }
}

export const AdminQuestionReportPage = (): ReactElement => {
  const { formatAdminDateTime, presentError, t } = useAdminPresentation()
  const [searchParams, setSearchParams] = useSearchParams()
  const parsedSearch = parseAdminQuestionReportSearch(searchParams)
  const query = parsedSearch.query
  const page = query.page
  const reports = usePhase7AdminQuestionReportList(query)
  const isPaused = reports.fetchStatus === 'paused'

  const setFilter = useCallback(
    (key: string, value: string): void => {
      const next = new URLSearchParams(searchParams)
      if (value && !(key === 'sort' && value === 'UPDATED_DESC')) {
        next.set(key, value)
      } else next.delete(key)
      if (key !== 'page') next.delete('page')
      setSearchParams(next)
    },
    [searchParams, setSearchParams]
  )

  const handleSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const next = new URLSearchParams(searchParams)
    for (const key of [
      'questionId',
      'assigneeActorId',
      'createdFrom',
      'createdTo',
      'updatedFrom',
      'updatedTo'
    ]) {
      const value = String(data.get(key) ?? '').trim()
      if (value) next.set(key, value)
      else next.delete(key)
    }
    next.delete('page')
    setSearchParams(next)
  }

  const totalPages = reports.data
    ? Math.max(1, Math.ceil(reports.data.total / reports.data.pageSize))
    : 1

  useEffect(() => {
    if (reports.data && page > totalPages) {
      setFilter('page', String(totalPages))
    }
  }, [page, reports.data, setFilter, totalPages])

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label={t('common.breadcrumbLabel')}>
        <Link
          className="font-semibold text-brand underline"
          to="/admin/questions"
        >
          {t('common.questions')}
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span aria-current="page">{t('common.reports')}</span>
      </nav>
      <header className="mt-6 border-b border-line pb-8">
        <p className="text-sm font-bold tracking-[0.14em] text-brand">
          {t('reportList.eyebrow')}
        </p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">
          {t('reportList.title')}
        </h1>
        <p className="mt-4 text-muted">{t('reportList.description')}</p>
      </header>
      <form
        className="mt-6 grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={handleSearch}
      >
        <Select
          label={t('reportList.status')}
          name="status"
          value={query.status ?? ''}
          onChange={(event) => setFilter('status', event.currentTarget.value)}
        >
          <option value="">{t('reportList.allStatuses')}</option>
          {statuses.map((item) => (
            <option key={item} value={item}>
              {t(adminReportStatusKey[item])}
            </option>
          ))}
        </Select>
        <Select
          label={t('reportList.reason')}
          name="reason"
          value={query.reason ?? ''}
          onChange={(event) => setFilter('reason', event.currentTarget.value)}
        >
          <option value="">{t('reportList.allReasons')}</option>
          {reasons.map((item) => (
            <option key={item} value={item}>
              {t(adminReportReasonKey[item])}
            </option>
          ))}
        </Select>
        <Input
          defaultValue={searchParams.get('questionId') ?? ''}
          key={`questionId:${searchParams.get('questionId') ?? ''}`}
          label={t('reportList.questionId')}
          maxLength={100}
          name="questionId"
          placeholder="UUID"
        />
        <Input
          defaultValue={searchParams.get('assigneeActorId') ?? ''}
          key={`assigneeActorId:${searchParams.get('assigneeActorId') ?? ''}`}
          label={t('reportList.assigneeActorId')}
          maxLength={100}
          name="assigneeActorId"
          placeholder="UUID"
        />
        {(
          [
            ['createdFrom', t('reportList.createdFrom')],
            ['createdTo', t('reportList.createdTo')],
            ['updatedFrom', t('reportList.updatedFrom')],
            ['updatedTo', t('reportList.updatedTo')]
          ] as const
        ).map(([name, label]) => (
          <Input
            defaultValue={searchParams.get(name) ?? ''}
            key={`${name}:${searchParams.get(name) ?? ''}`}
            label={label}
            maxLength={35}
            name={name}
            placeholder="2026-09-01T00:00:00.000Z"
          />
        ))}
        <Select
          label={t('reportList.sort')}
          name="sort"
          value={query.sort}
          onChange={(event) => setFilter('sort', event.currentTarget.value)}
        >
          {sorts.map((sort) => (
            <option key={sort} value={sort}>
              {t(adminReportSortKey[sort])}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit">{t('reportList.applySearch')}</Button>
          <Button
            variant="outline"
            onClick={() => setSearchParams(new URLSearchParams())}
          >
            {t('reportList.resetFilters')}
          </Button>
        </div>
      </form>

      {parsedSearch.error ? (
        <p className="mt-3 font-semibold text-red-700" role="alert">
          {t('reportList.invalidQuery')}
        </p>
      ) : null}

      {(reports.isError || isPaused) && reports.data ? (
        <div
          className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="alert"
        >
          <p className="font-semibold">
            {isPaused
              ? t('common.cachedPausedDescription')
              : t('reportList.cachedError')}
          </p>
          <p className="mt-1 text-sm">
            {isPaused
              ? t('common.pausedDescription')
              : presentError(reports.error)}
          </p>
          <button
            className="mt-3 min-h-11 rounded-lg border border-amber-700 px-4 font-semibold"
            type="button"
            onClick={() => void reports.refetch()}
          >
            {t('reportList.retry')}
          </button>
        </div>
      ) : null}

      {reports.isPending && !reports.data && isPaused ? (
        <ErrorState
          autoFocus
          className="mt-8"
          description={t('common.pausedDescription')}
          onRetry={() => void reports.refetch()}
          title={t('common.pausedTitle')}
        />
      ) : reports.isPending && !reports.data ? (
        <LoadingState className="mt-8" message={t('reportList.loading')} />
      ) : !reports.data ? (
        <ErrorState
          autoFocus
          className="mt-8"
          description={presentError(reports.error)}
          onRetry={() => void reports.refetch()}
        />
      ) : reports.data.items.length === 0 ? (
        <EmptyState
          className="mt-8"
          description={t('reportList.emptyDescription')}
          title={t('reportList.emptyTitle')}
        />
      ) : (
        <>
          <Table
            caption={t('reportList.tableCaption')}
            containerClassName="mt-8"
            minWidthClassName="min-w-[76rem]"
            scrollLabel={t('reportList.tableScrollLabel')}
          >
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3" scope="col">
                  {t('common.status')}
                </th>
                <th className="px-4 py-3" scope="col">
                  {t('common.reason')}
                </th>
                <th className="px-4 py-3" scope="col">
                  {t('common.question')}
                </th>
                <th className="px-4 py-3" scope="col">
                  {t('common.reporter')}
                </th>
                <th className="px-4 py-3" scope="col">
                  {t('common.assignee')}
                </th>
                <TableSortHeader
                  direction={
                    query.sort === 'CREATED_DESC' ? 'descending' : undefined
                  }
                  sortLabel={
                    query.sort === 'CREATED_DESC'
                      ? t('reportList.sortCreatedActive')
                      : t('reportList.sortCreated')
                  }
                  onSort={() => setFilter('sort', 'CREATED_DESC')}
                >
                  {t('common.createdAt')}
                </TableSortHeader>
                <TableSortHeader
                  direction={
                    query.sort === 'UPDATED_DESC' ? 'descending' : undefined
                  }
                  sortLabel={
                    query.sort === 'UPDATED_DESC'
                      ? t('reportList.sortUpdatedActive')
                      : t('reportList.sortUpdated')
                  }
                  onSort={() => setFilter('sort', 'UPDATED_DESC')}
                >
                  {t('common.updatedAt')}
                </TableSortHeader>
                <th className="px-4 py-3" scope="col">
                  {t('common.details')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reports.data.items.map((report) => (
                <tr key={report.id}>
                  <td className="px-4 py-4">
                    <Badge
                      variant={report.status === 'OPEN' ? 'warning' : 'neutral'}
                    >
                      {t(adminReportStatusKey[report.status])}
                    </Badge>
                  </td>
                  <td className="px-4 py-4">
                    {t(adminReportReasonKey[report.reason])}
                  </td>
                  <td className="px-4 py-4 font-mono text-xs">
                    {report.questionId}
                  </td>
                  <td className="px-4 py-4">
                    <span className="block">
                      {t(adminActorLabelKey[report.reporter.label])}
                    </span>
                    <span className="block font-mono text-xs text-muted">
                      {report.reporter.actorId}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {report.assignee ? (
                      <>
                        <span className="block">
                          {t(adminActorLabelKey[report.assignee.label])}
                        </span>
                        <span className="block font-mono text-xs text-muted">
                          {report.assignee.actorId}
                        </span>
                      </>
                    ) : (
                      t('common.unassigned')
                    )}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <time dateTime={report.createdAt}>
                      {formatAdminDateTime(report.createdAt)}
                    </time>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <time dateTime={report.updatedAt}>
                      {formatAdminDateTime(report.updatedAt)}
                    </time>
                  </td>
                  <td className="px-4 py-4">
                    <Link
                      className="inline-flex min-h-11 items-center font-semibold text-brand underline"
                      to={`/admin/reports/${report.id}`}
                    >
                      {t('common.open')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            className="mt-8"
            currentPage={query.page}
            disabled={reports.isFetching || reports.isError || isPaused}
            totalPages={totalPages}
            onPageChange={(page) => setFilter('page', String(page))}
          />
        </>
      )}
    </section>
  )
}

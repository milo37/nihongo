import { useCallback, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { FormEvent, ReactElement } from 'react'
import {
  listAdminQuestionReportsQuerySchema,
  type ListAdminQuestionReportsQuery
} from '@nihongo/contracts/admin/phase7'
import { isPhase7UiApiError } from '@app/admin-question/hooks/usePhase7AdminMutations'
import { usePhase7AdminQuestionReportList } from '@app/admin-question/hooks/usePhase7AdminQueries'
import { Badge } from '@common/components/Badge'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { Button } from '@common/components/Button'
import { Input } from '@common/components/Input'
import { LoadingState } from '@common/components/LoadingState'
import { Pagination } from '@common/components/Pagination'
import { Select } from '@common/components/Select'

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
  readonly error?: string
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
    error:
      'URL 신고 검색 조건이 허용 범위를 벗어났습니다. 안전한 기본 조건을 사용합니다.',
    query: { page: 1, pageSize: 20, sort: 'UPDATED_DESC' }
  }
}

export const AdminQuestionReportPage = (): ReactElement => {
  const [searchParams, setSearchParams] = useSearchParams()
  const parsedSearch = parseAdminQuestionReportSearch(searchParams)
  const query = parsedSearch.query
  const page = query.page
  const reports = usePhase7AdminQuestionReportList(query)

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
      <nav aria-label="현재 위치">
        <Link
          className="font-semibold text-brand underline"
          to="/admin/questions"
        >
          문제 관리
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span aria-current="page">신고 큐</span>
      </nav>
      <header className="mt-6 border-b border-line pb-8">
        <p className="text-sm font-bold tracking-[0.14em] text-brand">
          QUESTION REPORTS
        </p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">문제 신고 큐</h1>
        <p className="mt-4 text-muted">
          목록에서는 신고 설명을 노출하지 않습니다. 상세에서만 plain text로
          확인합니다.
        </p>
      </header>
      <form
        className="mt-6 grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={handleSearch}
      >
        <Select
          label="처리 상태"
          name="status"
          value={query.status ?? ''}
          onChange={(event) => setFilter('status', event.currentTarget.value)}
        >
          <option value="">전체 상태</option>
          {statuses.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
        <Select
          label="신고 사유"
          name="reason"
          value={query.reason ?? ''}
          onChange={(event) => setFilter('reason', event.currentTarget.value)}
        >
          <option value="">전체 사유</option>
          {reasons.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
        <Input
          defaultValue={searchParams.get('questionId') ?? ''}
          key={`questionId:${searchParams.get('questionId') ?? ''}`}
          label="문제 ID"
          maxLength={100}
          name="questionId"
          placeholder="UUID"
        />
        <Input
          defaultValue={searchParams.get('assigneeActorId') ?? ''}
          key={`assigneeActorId:${searchParams.get('assigneeActorId') ?? ''}`}
          label="담당자 actor ID"
          maxLength={100}
          name="assigneeActorId"
          placeholder="UUID"
        />
        {(
          [
            ['createdFrom', '신고 생성 시작 시각'],
            ['createdTo', '신고 생성 종료 시각'],
            ['updatedFrom', '신고 수정 시작 시각'],
            ['updatedTo', '신고 수정 종료 시각']
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
          label="정렬"
          name="sort"
          value={query.sort}
          onChange={(event) => setFilter('sort', event.currentTarget.value)}
        >
          <option value="UPDATED_DESC">최근 수정순</option>
          <option value="CREATED_DESC">최근 생성순</option>
        </Select>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit">검색 적용</Button>
          <Button
            variant="outline"
            onClick={() => setSearchParams(new URLSearchParams())}
          >
            필터 초기화
          </Button>
        </div>
      </form>

      {parsedSearch.error ? (
        <p className="mt-3 font-semibold text-red-700" role="alert">
          {parsedSearch.error}
        </p>
      ) : null}

      {reports.isError && reports.data ? (
        <div
          className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          role="alert"
        >
          <p className="font-semibold">
            최신 신고 큐를 확인하지 못했습니다. 현재 목록은 그대로 유지됩니다.
          </p>
          <p className="mt-1 text-sm">
            {isPhase7UiApiError(reports.error)
              ? (reports.error.serverMessage ?? reports.error.message)
              : '신고 큐를 불러오지 못했습니다.'}
          </p>
          <button
            className="mt-3 min-h-11 rounded-lg border border-amber-700 px-4 font-semibold"
            type="button"
            onClick={() => void reports.refetch()}
          >
            신고 큐 다시 확인
          </button>
        </div>
      ) : null}

      {reports.isPending && !reports.data ? (
        <LoadingState className="mt-8" message="신고 큐를 불러오는 중입니다…" />
      ) : !reports.data ? (
        <ErrorState
          autoFocus
          className="mt-8"
          description={
            isPhase7UiApiError(reports.error)
              ? (reports.error.serverMessage ?? reports.error.message)
              : '신고 큐를 불러오지 못했습니다.'
          }
          onRetry={() => void reports.refetch()}
        />
      ) : reports.data.items.length === 0 ? (
        <EmptyState
          className="mt-8"
          description="현재 조건에 맞는 신고가 없습니다."
          title="신고가 없습니다"
        />
      ) : (
        <>
          <div
            className="mt-8 overflow-x-auto rounded-2xl border border-line bg-white"
            role="region"
            aria-label="문제 신고 목록 가로 스크롤 영역"
            tabIndex={0}
          >
            <table className="w-full min-w-[76rem] text-left text-sm">
              <caption className="sr-only">
                문제 신고 큐 목록. 상태, 사유, 문제, 신고자, 담당자, 생성일,
                수정일, 상세 열로 구성됩니다.
              </caption>
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3" scope="col">
                    상태
                  </th>
                  <th className="px-4 py-3" scope="col">
                    사유
                  </th>
                  <th className="px-4 py-3" scope="col">
                    문제
                  </th>
                  <th className="px-4 py-3" scope="col">
                    신고자
                  </th>
                  <th className="px-4 py-3" scope="col">
                    담당자
                  </th>
                  <th
                    className="px-4 py-3"
                    scope="col"
                    aria-sort={
                      query.sort === 'CREATED_DESC' ? 'descending' : undefined
                    }
                  >
                    생성일
                  </th>
                  <th
                    className="px-4 py-3"
                    scope="col"
                    aria-sort={
                      query.sort === 'UPDATED_DESC' ? 'descending' : undefined
                    }
                  >
                    수정일
                  </th>
                  <th className="px-4 py-3" scope="col">
                    상세
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {reports.data.items.map((report) => (
                  <tr key={report.id}>
                    <td className="px-4 py-4">
                      <Badge
                        variant={
                          report.status === 'OPEN' ? 'warning' : 'neutral'
                        }
                      >
                        {report.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-4">{report.reason}</td>
                    <td className="px-4 py-4 font-mono text-xs">
                      {report.questionId}
                    </td>
                    <td className="px-4 py-4">
                      <span className="block">{report.reporter.label}</span>
                      <span className="block font-mono text-xs text-muted">
                        {report.reporter.actorId}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {report.assignee ? (
                        <>
                          <span className="block">{report.assignee.label}</span>
                          <span className="block font-mono text-xs text-muted">
                            {report.assignee.actorId}
                          </span>
                        </>
                      ) : (
                        '미할당'
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {new Date(report.createdAt).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {new Date(report.updatedAt).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-4 py-4">
                      <Link
                        className="inline-flex min-h-11 items-center font-semibold text-brand underline"
                        to={`/admin/reports/${report.id}`}
                      >
                        열기
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            className="mt-8"
            currentPage={query.page}
            totalPages={totalPages}
            onPageChange={(page) => setFilter('page', String(page))}
          />
        </>
      )}
    </section>
  )
}

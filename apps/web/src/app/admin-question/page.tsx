import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { FormEvent, ReactElement } from 'react'
import type {
  AdminQuestionSummary,
  ListAdminQuestionsQuery
} from '@nihongo/contracts/admin/phase7'
import { listAdminQuestionsQuerySchema } from '@nihongo/contracts/admin/phase7'
import { FreshAssuranceDialog } from '@app/admin-question/components/FreshAssuranceDialog'
import { useFreshAssurance } from '@app/admin-question/hooks/useFreshAssurance'
import {
  isPhase7UiApiError,
  usePhase7AdminExport,
  usePhase7ContentReviewBatch
} from '@app/admin-question/hooks/usePhase7AdminMutations'
import { usePhase7AdminQuestionList } from '@app/admin-question/hooks/usePhase7AdminQueries'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { Input } from '@common/components/Input'
import { LoadingState } from '@common/components/LoadingState'
import { Pagination } from '@common/components/Pagination'
import { Select } from '@common/components/Select'
import { Table, TableSortHeader } from '@common/components/Table'

const levels = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
const subjects = ['VOCABULARY', 'GRAMMAR', 'READING'] as const
const lifecycleStatuses = ['ACTIVE', 'ARCHIVED'] as const
const difficulties = ['EASY', 'NORMAL', 'HARD'] as const
const questionTypes = [
  'KANJI_READING',
  'ORTHOGRAPHY',
  'CONTEXT_VOCABULARY',
  'PARAPHRASE',
  'WORD_USAGE',
  'GRAMMAR_SELECT',
  'SENTENCE_ORDER',
  'TEXT_GRAMMAR',
  'SHORT_READING',
  'MEDIUM_READING',
  'LONG_READING',
  'INFO_RETRIEVAL'
] as const
const versionStatuses = [
  'DRAFT',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'PUBLISHED',
  'RETIRED'
] as const
const sorts = [
  'UPDATED_DESC',
  'CREATED_DESC',
  'LEVEL_ASC',
  'REPORT_COUNT_DESC'
] as const

const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const

const versionStatusLabels: Record<
  AdminQuestionSummary['versionStatus'],
  string
> = {
  DRAFT: '초안',
  IN_REVIEW: '검수 중',
  CHANGES_REQUESTED: '수정 요청',
  APPROVED: '승인',
  PUBLISHED: '공개',
  RETIRED: '공개 중단'
}

const sortLabels = {
  UPDATED_DESC: '최근 수정순',
  CREATED_DESC: '최근 생성순',
  LEVEL_ASC: '급수순',
  REPORT_COUNT_DESC: '신고 많은 순'
} as const

const asMember = <Value extends string>(
  value: string | null,
  values: readonly Value[]
): Value | undefined =>
  value !== null && values.includes(value as Value)
    ? (value as Value)
    : undefined

const positiveInteger = (value: string | null): number => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1
}

interface ParsedAdminQuestionSearch {
  readonly error?: string
  readonly query: ListAdminQuestionsQuery
}

export const parseAdminQuestionSearch = (
  searchParams: URLSearchParams
): ParsedAdminQuestionSearch => {
  const optionalText = (key: string): string | undefined => {
    const value = searchParams.get(key)?.trim()
    return value ? value : undefined
  }
  const candidate = {
    page: positiveInteger(searchParams.get('page')),
    pageSize: 20,
    sort: asMember(searchParams.get('sort'), sorts) ?? 'UPDATED_DESC',
    ...(optionalText('q') ? { q: optionalText('q') } : {}),
    ...(asMember(searchParams.get('level'), levels)
      ? { level: asMember(searchParams.get('level'), levels) }
      : {}),
    ...(asMember(searchParams.get('subject'), subjects)
      ? { subject: asMember(searchParams.get('subject'), subjects) }
      : {}),
    ...(asMember(searchParams.get('questionType'), questionTypes)
      ? {
          questionType: asMember(
            searchParams.get('questionType'),
            questionTypes
          )
        }
      : {}),
    ...(asMember(searchParams.get('difficulty'), difficulties)
      ? {
          difficulty: asMember(searchParams.get('difficulty'), difficulties)
        }
      : {}),
    ...(asMember(searchParams.get('lifecycleStatus'), lifecycleStatuses)
      ? {
          lifecycleStatus: asMember(
            searchParams.get('lifecycleStatus'),
            lifecycleStatuses
          )
        }
      : {}),
    ...(asMember(searchParams.get('versionStatus'), versionStatuses)
      ? {
          versionStatus: asMember(
            searchParams.get('versionStatus'),
            versionStatuses
          )
        }
      : {}),
    ...(optionalText('tag') ? { tag: optionalText('tag') } : {}),
    ...(optionalText('authorActorId')
      ? { authorActorId: optionalText('authorActorId') }
      : {}),
    ...(optionalText('reviewerActorId')
      ? { reviewerActorId: optionalText('reviewerActorId') }
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
  const parsed = listAdminQuestionsQuerySchema.safeParse(candidate)
  if (parsed.success) return { query: parsed.data }
  return {
    error:
      'URL 검색 조건이 허용 범위를 벗어났습니다. 조건을 수정하거나 초기화해 주세요.',
    query: { page: 1, pageSize: 20, sort: 'UPDATED_DESC' }
  }
}

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))

const errorMessage = (error: unknown): string => {
  if (!isPhase7UiApiError(error)) {
    return '관리자 문제 목록을 처리하지 못했습니다.'
  }
  if (error.isOffline) {
    return '오프라인 상태입니다. 입력과 선택은 유지됩니다.'
  }
  const message = error.serverMessage ?? error.message
  return error.retryAfterMs
    ? `${message} ${Math.ceil(error.retryAfterMs / 1000)}초 뒤 다시 시도해 주세요.`
    : message
}

const canRequestReview = (item: AdminQuestionSummary): boolean =>
  item.lifecycleStatus === 'ACTIVE' &&
  (item.versionStatus === 'DRAFT' || item.versionStatus === 'CHANGES_REQUESTED')

export const AdminQuestionPage = (): ReactElement => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [announcement, setAnnouncement] = useState('')
  const [batchConflictRefreshError, setBatchConflictRefreshError] = useState<
    string | null
  >(null)
  const freshAssurance = useFreshAssurance()
  const parsedSearch = parseAdminQuestionSearch(searchParams)
  const query = parsedSearch.query
  const page = query.page
  const list = usePhase7AdminQuestionList(query)
  const selectableById = useMemo(
    () =>
      new Map((list.data?.items ?? []).map((item) => [item.questionId, item])),
    [list.data?.items]
  )
  const selectedItems = [...selectedIds].flatMap((questionId) => {
    const item = selectableById.get(questionId)
    return item ? [item] : []
  })
  const reviewableSelectedItems = selectedItems.filter(canRequestReview)

  const batchReview = usePhase7ContentReviewBatch(
    (count) => {
      setBatchConflictRefreshError(null)
      setSelectedIds(new Set())
      setAnnouncement(`${count}개 문제를 모두 검수 요청했습니다.`)
    },
    (error, input) => {
      if (
        isPhase7UiApiError(error) &&
        error.code === 'FRESH_ASSURANCE_REQUIRED'
      ) {
        freshAssurance.open({
          questionIds: input.targets.map((item) => item.questionId),
          reason: '일괄 검수 요청은 민감한 관리자 작업입니다.'
        })
      }
    }
  )

  const exportQuestions = usePhase7AdminExport(
    (result) => {
      const url = URL.createObjectURL(
        new Blob([result.bytes], { type: 'application/json;charset=utf-8' })
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.fileName
      anchor.click()
      URL.revokeObjectURL(url)
      setAnnouncement(
        `${result.document.questions.length}개 문제 내보내기를 시작했습니다.`
      )
    },
    (error, questionIds) => {
      if (
        isPhase7UiApiError(error) &&
        error.code === 'FRESH_ASSURANCE_REQUIRED'
      ) {
        freshAssurance.open({
          questionIds: [...questionIds],
          reason: '문제 내보내기에는 민감한 정답·해설이 포함됩니다.'
        })
      }
    }
  )

  const setFilter = useCallback(
    (key: string, value: string): void => {
      const next = new URLSearchParams(searchParams)
      if (value.length === 0 || (key === 'sort' && value === 'UPDATED_DESC')) {
        next.delete(key)
      } else {
        next.set(key, value)
      }
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
      'q',
      'tag',
      'authorActorId',
      'reviewerActorId',
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

  const toggleSelection = (questionId: string): void => {
    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((candidateId) => selectableById.has(candidateId))
      )
      if (next.has(questionId)) next.delete(questionId)
      else if (next.size < 100) next.add(questionId)
      return next
    })
  }

  const totalPages = list.data
    ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize))
    : 1
  const hasBatchVersionConflict =
    batchReview.error !== null &&
    isPhase7UiApiError(batchReview.error) &&
    batchReview.error.code === 'VERSION_CONFLICT'

  const refreshBatchConflict = async (): Promise<void> => {
    setBatchConflictRefreshError(null)
    const refreshed = await list.refetch()
    if (!refreshed.isSuccess || !refreshed.data) {
      setBatchConflictRefreshError(
        '최신 목록을 확인하지 못했습니다. 선택 상태는 유지됩니다. 네트워크를 확인한 뒤 다시 시도해 주세요.'
      )
      return
    }
    batchReview.reset()
    setAnnouncement(
      '최신 문제 상태를 반영했습니다. 선택 내용을 확인한 뒤 검수 요청을 다시 실행해 주세요.'
    )
  }

  useEffect(() => {
    if (list.data && page > totalPages) {
      setFilter('page', String(totalPages))
    }
  }, [list.data, page, setFilter, totalPages])

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-col gap-6 border-b border-line pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-bold tracking-[0.14em] text-brand">
            ADMIN QUESTION CMS · TECHNICAL MODE
          </p>
          <h1 className="mt-2 text-balance text-3xl font-black tracking-tight sm:text-4xl">
            문제 관리
          </h1>
          <p className="mt-4 text-pretty leading-7 text-muted">
            TEST/DEVELOPMENT용 버전·검수 워크플로입니다. 실제 사람 검수나 운영
            공개를 의미하지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="button-link-secondary" to="/admin/reports">
            신고 큐
          </Link>
          <Link className="button-link-secondary" to="/admin/audit-log">
            감사 기록
          </Link>
          <Link className="button-link-secondary" to="/admin/questions/import">
            가져오기
          </Link>
          <Link className="button-link-primary" to="/admin/questions/new">
            새 문제
          </Link>
        </div>
      </div>

      <form
        className="mt-8 grid gap-3 rounded-panel border border-line bg-surface p-4 shadow-control sm:grid-cols-2 lg:grid-cols-4"
        role="search"
        onSubmit={handleSearch}
      >
        <div className="sm:col-span-2 lg:col-span-4">
          <Input
            defaultValue={searchParams.get('q') ?? ''}
            key={`q:${searchParams.get('q') ?? ''}`}
            label="문제 문장 앞부분 검색"
            maxLength={100}
            name="q"
            placeholder="검색어 입력"
          />
        </div>
        <Select
          label="급수"
          name="level"
          value={query.level ?? ''}
          onChange={(event) => setFilter('level', event.currentTarget.value)}
        >
          <option value="">전체 급수</option>
          {levels.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <Select
          label="문제 유형"
          name="questionType"
          value={query.questionType ?? ''}
          onChange={(event) =>
            setFilter('questionType', event.currentTarget.value)
          }
        >
          <option value="">전체 문제 유형</option>
          {questionTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
        <Select
          label="난이도"
          name="difficulty"
          value={query.difficulty ?? ''}
          onChange={(event) =>
            setFilter('difficulty', event.currentTarget.value)
          }
        >
          <option value="">전체 난이도</option>
          {difficulties.map((difficulty) => (
            <option key={difficulty} value={difficulty}>
              {difficulty}
            </option>
          ))}
        </Select>
        <Select
          label="문제 수명주기"
          name="lifecycleStatus"
          value={query.lifecycleStatus ?? ''}
          onChange={(event) =>
            setFilter('lifecycleStatus', event.currentTarget.value)
          }
        >
          <option value="">전체 수명주기</option>
          {lifecycleStatuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </Select>
        <Select
          label="과목"
          name="subject"
          value={query.subject ?? ''}
          onChange={(event) => setFilter('subject', event.currentTarget.value)}
        >
          <option value="">전체 과목</option>
          {subjects.map((item) => (
            <option key={item} value={item}>
              {subjectLabels[item]}
            </option>
          ))}
        </Select>
        <Input
          defaultValue={searchParams.get('tag') ?? ''}
          key={`tag:${searchParams.get('tag') ?? ''}`}
          label="태그 key"
          maxLength={500}
          name="tag"
          placeholder="등록된 태그 검색 key"
        />
        <Input
          defaultValue={searchParams.get('authorActorId') ?? ''}
          key={`authorActorId:${searchParams.get('authorActorId') ?? ''}`}
          label="작성자 actor ID"
          maxLength={100}
          name="authorActorId"
          placeholder="UUID"
        />
        <Input
          defaultValue={searchParams.get('reviewerActorId') ?? ''}
          key={`reviewerActorId:${searchParams.get('reviewerActorId') ?? ''}`}
          label="검수자 actor ID"
          maxLength={100}
          name="reviewerActorId"
          placeholder="UUID"
        />
        {(
          [
            ['createdFrom', '생성 시작 시각'],
            ['createdTo', '생성 종료 시각'],
            ['updatedFrom', '수정 시작 시각'],
            ['updatedTo', '수정 종료 시각']
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
          label="버전 상태"
          name="versionStatus"
          value={query.versionStatus ?? ''}
          onChange={(event) =>
            setFilter('versionStatus', event.currentTarget.value)
          }
        >
          <option value="">전체 상태</option>
          {versionStatuses.map((status) => (
            <option key={status} value={status}>
              {versionStatusLabels[status]}
            </option>
          ))}
        </Select>
        <Select
          label="정렬"
          name="sort"
          value={query.sort}
          onChange={(event) => setFilter('sort', event.currentTarget.value)}
        >
          {sorts.map((sort) => (
            <option key={sort} value={sort}>
              {sortLabels[sort]}
            </option>
          ))}
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
        <p className="mt-3 font-semibold text-danger" role="alert">
          {parsedSearch.error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 rounded-panel border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-semibold" aria-live="polite">
          {selectedItems.length}개 선택됨 · 내보내기는 모든 상태에서 최대 100개,
          일괄 검수는 ACTIVE 초안·수정 요청만 최대 20개입니다. 현재 검수 요청
          가능 {reviewableSelectedItems.length}개
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              reviewableSelectedItems.length === 0 ||
              reviewableSelectedItems.length !== selectedItems.length ||
              reviewableSelectedItems.length > 20
            }
            isLoading={batchReview.isPending}
            loadingLabel="요청 중…"
            onClick={() =>
              batchReview.mutate({
                request: {
                  items: reviewableSelectedItems.map((item) => ({
                    versionId: item.selectedVersionId,
                    expectedRowVersion: item.versionRowVersion
                  }))
                },
                targets: reviewableSelectedItems
              })
            }
          >
            선택 항목 검수 요청
          </Button>
          <Button
            disabled={selectedItems.length === 0}
            isLoading={exportQuestions.isPending}
            loadingLabel="검증 중…"
            variant="dark"
            onClick={() =>
              exportQuestions.mutate(
                selectedItems.map((item) => item.questionId)
              )
            }
          >
            민감 자료 내보내기
          </Button>
        </div>
      </div>

      {batchReview.error || exportQuestions.error ? (
        <ErrorState
          className="mt-4"
          description={
            batchConflictRefreshError ??
            errorMessage(batchReview.error ?? exportQuestions.error)
          }
          onRetry={
            hasBatchVersionConflict
              ? () => void refreshBatchConflict()
              : undefined
          }
          retryLabel="최신 문제 목록 불러오기"
          title={
            hasBatchVersionConflict
              ? '다른 작업에서 문제 버전이 변경됐습니다'
              : '작업을 완료하지 못했습니다'
          }
        />
      ) : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement || freshAssurance.completionMessage}
      </p>

      {list.isError && list.data ? (
        <div
          className="mt-4 rounded-panel border border-warning-line bg-warning-soft p-4 text-warning-strong"
          role="alert"
        >
          <p className="font-semibold">
            최신 목록을 확인하지 못했습니다. 현재 목록과 선택 상태는 그대로
            유지됩니다.
          </p>
          <p className="mt-1 text-sm">{errorMessage(list.error)}</p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => void list.refetch()}
          >
            목록 다시 확인
          </Button>
        </div>
      ) : null}

      {list.isPending && !list.data ? (
        <LoadingState
          className="mt-8"
          message="관리자 문제를 불러오는 중입니다…"
        />
      ) : !list.data ? (
        <ErrorState
          autoFocus
          className="mt-8"
          description={errorMessage(list.error)}
          onRetry={() => void list.refetch()}
          title="문제 목록을 불러오지 못했습니다"
        />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          className="mt-8"
          description="검색 조건을 바꾸거나 새 문제를 만들어 주세요."
          title="표시할 문제가 없습니다"
        />
      ) : (
        <>
          <p className="mt-8 text-sm text-muted" id="admin-table-help">
            표가 화면보다 넓으면 가로로 스크롤할 수 있습니다.
            {list.isFetching ? ' 최신 목록을 확인 중입니다.' : ''}
          </p>
          <Table
            caption="관리자 문제 목록. 선택, 문제, 분류, 버전 상태, 풀이·정답률, 신고, 생성일, 수정일, 상세 열로 구성됩니다."
            containerClassName="mt-2 rounded-panel shadow-control"
            descriptionId="admin-table-help"
            minWidthClassName="min-w-[84rem]"
            scrollLabel="관리자 문제 목록 가로 스크롤 영역"
          >
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-4 py-3" scope="col">
                  선택
                </th>
                <th className="px-4 py-3" scope="col">
                  문제
                </th>
                <TableSortHeader
                  direction={
                    query.sort === 'LEVEL_ASC' ? 'ascending' : undefined
                  }
                  sortLabel={
                    query.sort === 'LEVEL_ASC'
                      ? '분류, 급수 오름차순 정렬됨'
                      : '분류, 급수 오름차순으로 정렬'
                  }
                  onSort={() => setFilter('sort', 'LEVEL_ASC')}
                >
                  분류
                </TableSortHeader>
                <th className="px-4 py-3" scope="col">
                  상태
                </th>
                <th className="px-4 py-3" scope="col">
                  풀이·정답률
                </th>
                <TableSortHeader
                  direction={
                    query.sort === 'REPORT_COUNT_DESC'
                      ? 'descending'
                      : undefined
                  }
                  sortLabel={
                    query.sort === 'REPORT_COUNT_DESC'
                      ? '신고, 많은 순 정렬됨'
                      : '신고, 많은 순으로 정렬'
                  }
                  onSort={() => setFilter('sort', 'REPORT_COUNT_DESC')}
                >
                  신고
                </TableSortHeader>
                <TableSortHeader
                  direction={
                    query.sort === 'CREATED_DESC' ? 'descending' : undefined
                  }
                  sortLabel={
                    query.sort === 'CREATED_DESC'
                      ? '생성일, 최근순 정렬됨'
                      : '생성일, 최근순으로 정렬'
                  }
                  onSort={() => setFilter('sort', 'CREATED_DESC')}
                >
                  생성일
                </TableSortHeader>
                <TableSortHeader
                  direction={
                    query.sort === 'UPDATED_DESC' ? 'descending' : undefined
                  }
                  sortLabel={
                    query.sort === 'UPDATED_DESC'
                      ? '수정일, 최근순 정렬됨'
                      : '수정일, 최근순으로 정렬'
                  }
                  onSort={() => setFilter('sort', 'UPDATED_DESC')}
                >
                  수정일
                </TableSortHeader>
                <th className="px-4 py-3" scope="col">
                  상세
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data.items.map((item) => (
                <tr key={item.questionId} className="align-top">
                  <td className="px-4 py-4">
                    <label className="inline-flex size-11 cursor-pointer items-center justify-center rounded-control hover:bg-surface-muted focus-within:outline focus-within:outline-focus focus-within:outline-offset-focus focus-within:outline-brand">
                      <input
                        className="size-5 accent-brand"
                        checked={selectedItems.some(
                          (selected) => selected.questionId === item.questionId
                        )}
                        type="checkbox"
                        onChange={() => toggleSelection(item.questionId)}
                      />
                      <span className="sr-only">
                        {item.questionTextPreview} 선택
                      </span>
                    </label>
                  </td>
                  <th className="max-w-xl px-4 py-4 font-medium" scope="row">
                    <span className="line-clamp-2">
                      {item.questionTextPreview}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-muted">
                      {item.questionId}
                    </span>
                  </th>
                  <td className="px-4 py-4">
                    {item.level} · {subjectLabels[item.subject]}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge
                        variant={
                          item.lifecycleStatus === 'ARCHIVED'
                            ? 'danger'
                            : 'neutral'
                        }
                      >
                        {item.lifecycleStatus === 'ACTIVE' ? '활성' : '보관됨'}
                      </Badge>
                      <Badge variant="info">
                        {versionStatusLabels[item.versionStatus]}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap tabular-nums">
                    {item.answerCount}회 ·{' '}
                    {item.correctRateBasisPoints === null
                      ? '정답률 없음'
                      : `정답률 ${(item.correctRateBasisPoints / 100).toFixed(1)}%`}
                  </td>
                  <td className="px-4 py-4 tabular-nums">
                    {item.openReportCount}건
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    {formatDate(item.createdAt)}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    {formatDate(item.updatedAt)}
                  </td>
                  <td className="px-4 py-4">
                    <Link
                      className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-brand underline decoration-2 underline-offset-4 focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
                      to={`/admin/questions/${item.questionId}`}
                    >
                      열기
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            className="mt-8"
            currentPage={page}
            disabled={list.isFetching}
            totalPages={totalPages}
            onPageChange={(nextPage) => setFilter('page', String(nextPage))}
          />
        </>
      )}

      <FreshAssuranceDialog controller={freshAssurance} />
    </section>
  )
}

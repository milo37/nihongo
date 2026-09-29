import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { FormEvent, ReactElement } from 'react'
import type {
  AdminQuestionSummary,
  ListAdminQuestionsQuery
} from '@nihongo/contracts/admin/phase7'
import { listAdminQuestionsQuerySchema } from '@nihongo/contracts/admin/phase7'
import {
  adminDifficultyKey,
  adminLifecycleStatusKey,
  adminQuestionSortKey,
  adminQuestionTypeKey,
  adminSubjectKey,
  adminVersionStatusKey
} from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
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
  readonly error?: 'INVALID_QUERY'
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
    error: 'INVALID_QUERY',
    query: { page: 1, pageSize: 20, sort: 'UPDATED_DESC' }
  }
}

const canRequestReview = (item: AdminQuestionSummary): boolean =>
  item.lifecycleStatus === 'ACTIVE' &&
  (item.versionStatus === 'DRAFT' || item.versionStatus === 'CHANGES_REQUESTED')

export const AdminQuestionPage = (): ReactElement => {
  const {
    formatAdminDateTime,
    formatAdminNumber,
    formatAdminPercent,
    presentError,
    t
  } = useAdminPresentation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [announcement, setAnnouncement] = useState<
    | { readonly count: number; readonly kind: 'BATCH_COMPLETE' }
    | { readonly count: number; readonly kind: 'EXPORT_STARTED' }
    | { readonly kind: 'CONFLICT_REFRESHED' }
    | null
  >(null)
  const [batchConflictRefreshFailed, setBatchConflictRefreshFailed] =
    useState(false)
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
      setBatchConflictRefreshFailed(false)
      setSelectedIds(new Set())
      setAnnouncement({ count, kind: 'BATCH_COMPLETE' })
    },
    (error, input) => {
      if (
        isPhase7UiApiError(error) &&
        error.code === 'FRESH_ASSURANCE_REQUIRED'
      ) {
        freshAssurance.open({
          questionIds: input.targets.map((item) => item.questionId),
          reasonCode: 'BATCH_REVIEW'
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
      setAnnouncement({
        count: result.document.questions.length,
        kind: 'EXPORT_STARTED'
      })
    },
    (error, questionIds) => {
      if (
        isPhase7UiApiError(error) &&
        error.code === 'FRESH_ASSURANCE_REQUIRED'
      ) {
        freshAssurance.open({
          questionIds: [...questionIds],
          reasonCode: 'EXPORT'
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
  const isPaused = list.fetchStatus === 'paused'
  const writesLocked = isPaused || list.isError || list.isFetching

  const refreshBatchConflict = async (): Promise<void> => {
    setBatchConflictRefreshFailed(false)
    const refreshed = await list.refetch()
    if (!refreshed.isSuccess || !refreshed.data) {
      setBatchConflictRefreshFailed(true)
      return
    }
    batchReview.reset()
    setAnnouncement({ kind: 'CONFLICT_REFRESHED' })
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
            {t('questionList.eyebrow')}
          </p>
          <h1 className="mt-2 text-balance text-3xl font-black tracking-tight sm:text-4xl">
            {t('questionList.title')}
          </h1>
          <p className="mt-4 text-pretty leading-7 text-muted">
            {t('questionList.description')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="inline-flex min-h-11 items-center rounded-control border border-line px-4 font-semibold text-brand hover:bg-surface-muted focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
            to="/admin/reports"
          >
            {t('common.reports')}
          </Link>
          <Link
            className="inline-flex min-h-11 items-center rounded-control border border-line px-4 font-semibold text-brand hover:bg-surface-muted focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
            to="/admin/audit-log"
          >
            {t('common.auditLog')}
          </Link>
          <Link
            className="inline-flex min-h-11 items-center rounded-control border border-line px-4 font-semibold text-brand hover:bg-surface-muted focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
            to="/admin/questions/import"
          >
            {t('common.import')}
          </Link>
          <Link
            className="inline-flex min-h-11 items-center rounded-control bg-brand px-4 font-semibold text-on-accent hover:bg-brand-strong focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
            to="/admin/questions/new"
          >
            {t('common.newQuestion')}
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
            label={t('questionList.searchLabel')}
            maxLength={100}
            name="q"
            placeholder={t('questionList.searchPlaceholder')}
          />
        </div>
        <Select
          label={t('questionList.level')}
          name="level"
          value={query.level ?? ''}
          onChange={(event) => setFilter('level', event.currentTarget.value)}
        >
          <option value="">{t('questionList.allLevels')}</option>
          {levels.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <Select
          label={t('questionList.questionType')}
          name="questionType"
          value={query.questionType ?? ''}
          onChange={(event) =>
            setFilter('questionType', event.currentTarget.value)
          }
        >
          <option value="">{t('questionList.allQuestionTypes')}</option>
          {questionTypes.map((type) => (
            <option key={type} value={type}>
              {t(adminQuestionTypeKey[type])}
            </option>
          ))}
        </Select>
        <Select
          label={t('questionList.difficulty')}
          name="difficulty"
          value={query.difficulty ?? ''}
          onChange={(event) =>
            setFilter('difficulty', event.currentTarget.value)
          }
        >
          <option value="">{t('questionList.allDifficulties')}</option>
          {difficulties.map((difficulty) => (
            <option key={difficulty} value={difficulty}>
              {t(adminDifficultyKey[difficulty])}
            </option>
          ))}
        </Select>
        <Select
          label={t('questionList.lifecycle')}
          name="lifecycleStatus"
          value={query.lifecycleStatus ?? ''}
          onChange={(event) =>
            setFilter('lifecycleStatus', event.currentTarget.value)
          }
        >
          <option value="">{t('questionList.allLifecycles')}</option>
          {lifecycleStatuses.map((status) => (
            <option key={status} value={status}>
              {t(adminLifecycleStatusKey[status])}
            </option>
          ))}
        </Select>
        <Select
          label={t('questionList.subject')}
          name="subject"
          value={query.subject ?? ''}
          onChange={(event) => setFilter('subject', event.currentTarget.value)}
        >
          <option value="">{t('questionList.allSubjects')}</option>
          {subjects.map((item) => (
            <option key={item} value={item}>
              {t(adminSubjectKey[item])}
            </option>
          ))}
        </Select>
        <Input
          defaultValue={searchParams.get('tag') ?? ''}
          key={`tag:${searchParams.get('tag') ?? ''}`}
          label={t('questionList.tagKey')}
          maxLength={500}
          name="tag"
          placeholder={t('questionList.tagPlaceholder')}
        />
        <Input
          defaultValue={searchParams.get('authorActorId') ?? ''}
          key={`authorActorId:${searchParams.get('authorActorId') ?? ''}`}
          label={t('questionList.authorActorId')}
          maxLength={100}
          name="authorActorId"
          placeholder="UUID"
        />
        <Input
          defaultValue={searchParams.get('reviewerActorId') ?? ''}
          key={`reviewerActorId:${searchParams.get('reviewerActorId') ?? ''}`}
          label={t('questionList.reviewerActorId')}
          maxLength={100}
          name="reviewerActorId"
          placeholder="UUID"
        />
        {(
          [
            ['createdFrom', t('questionList.createdFrom')],
            ['createdTo', t('questionList.createdTo')],
            ['updatedFrom', t('questionList.updatedFrom')],
            ['updatedTo', t('questionList.updatedTo')]
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
          label={t('questionList.versionStatus')}
          name="versionStatus"
          value={query.versionStatus ?? ''}
          onChange={(event) =>
            setFilter('versionStatus', event.currentTarget.value)
          }
        >
          <option value="">{t('questionList.allStatuses')}</option>
          {versionStatuses.map((status) => (
            <option key={status} value={status}>
              {t(adminVersionStatusKey[status])}
            </option>
          ))}
        </Select>
        <Select
          label={t('questionList.sort')}
          name="sort"
          value={query.sort}
          onChange={(event) => setFilter('sort', event.currentTarget.value)}
        >
          {sorts.map((sort) => (
            <option key={sort} value={sort}>
              {t(adminQuestionSortKey[sort])}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit">{t('questionList.applySearch')}</Button>
          <Button
            variant="outline"
            onClick={() => setSearchParams(new URLSearchParams())}
          >
            {t('questionList.resetFilters')}
          </Button>
        </div>
      </form>

      {parsedSearch.error ? (
        <p className="mt-3 font-semibold text-danger" role="alert">
          {t('questionList.invalidQuery')}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 rounded-panel border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-semibold" aria-live="polite">
          {t('questionList.selectionSummary', {
            reviewableCount: formatAdminNumber(reviewableSelectedItems.length),
            selectedCount: formatAdminNumber(selectedItems.length)
          })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              writesLocked ||
              reviewableSelectedItems.length === 0 ||
              reviewableSelectedItems.length !== selectedItems.length ||
              reviewableSelectedItems.length > 20
            }
            isLoading={batchReview.isPending}
            loadingLabel={t('questionList.requesting')}
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
            {t('questionList.requestReview')}
          </Button>
          <Button
            disabled={writesLocked || selectedItems.length === 0}
            isLoading={exportQuestions.isPending}
            loadingLabel={t('questionList.validating')}
            variant="dark"
            onClick={() =>
              exportQuestions.mutate(
                selectedItems.map((item) => item.questionId)
              )
            }
          >
            {t('questionList.export')}
          </Button>
        </div>
      </div>

      {batchReview.error || exportQuestions.error ? (
        <ErrorState
          className="mt-4"
          description={
            batchConflictRefreshFailed
              ? t('questionList.conflictRefreshFailed')
              : presentError(batchReview.error ?? exportQuestions.error)
          }
          onRetry={
            hasBatchVersionConflict
              ? () => void refreshBatchConflict()
              : undefined
          }
          retryLabel={t('questionList.retryConflict')}
          title={
            hasBatchVersionConflict
              ? t('questionList.conflictTitle')
              : t('questionList.actionFailedTitle')
          }
        />
      ) : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement?.kind === 'BATCH_COMPLETE'
          ? t('questionList.batchComplete', {
              formattedCount: formatAdminNumber(announcement.count)
            })
          : announcement?.kind === 'EXPORT_STARTED'
            ? t('questionList.exportStarted', {
                formattedCount: formatAdminNumber(announcement.count)
              })
            : announcement?.kind === 'CONFLICT_REFRESHED'
              ? t('questionList.conflictRefreshed')
              : ''}
      </p>
      {freshAssurance.completionMessage ? (
        <p
          className="mt-4 rounded-panel border border-success-line bg-success-soft p-4 font-semibold text-success-strong"
          role="status"
        >
          {freshAssurance.completionMessage}
        </p>
      ) : null}

      {(list.isError || isPaused) && list.data ? (
        <div
          className="mt-4 rounded-panel border border-warning-line bg-warning-soft p-4 text-warning-strong"
          role="alert"
        >
          <p className="font-semibold">
            {isPaused
              ? t('common.cachedPausedDescription')
              : t('questionList.cachedError')}
          </p>
          <p className="mt-1 text-sm">
            {isPaused
              ? t('common.pausedDescription')
              : presentError(list.error)}
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => void list.refetch()}
          >
            {t('questionList.retryList')}
          </Button>
        </div>
      ) : null}

      {list.isPending && !list.data && isPaused ? (
        <ErrorState
          autoFocus
          className="mt-8"
          description={t('common.pausedDescription')}
          onRetry={() => void list.refetch()}
          title={t('common.pausedTitle')}
        />
      ) : list.isPending && !list.data ? (
        <LoadingState className="mt-8" message={t('questionList.loading')} />
      ) : !list.data ? (
        <ErrorState
          autoFocus
          className="mt-8"
          description={presentError(list.error)}
          onRetry={() => void list.refetch()}
          title={t('questionList.loadErrorTitle')}
        />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          className="mt-8"
          description={t('questionList.emptyDescription')}
          title={t('questionList.emptyTitle')}
        />
      ) : (
        <>
          <p className="mt-8 text-sm text-muted" id="admin-table-help">
            {t('questionList.tableHelp')}
            {list.isFetching ? t('questionList.tableRefreshing') : ''}
          </p>
          <Table
            caption={t('questionList.tableCaption')}
            containerClassName="mt-2 rounded-panel shadow-control"
            descriptionId="admin-table-help"
            minWidthClassName="min-w-[84rem]"
            scrollLabel={t('questionList.tableScrollLabel')}
          >
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="px-4 py-3" scope="col">
                  {t('questionList.columns.select')}
                </th>
                <th className="px-4 py-3" scope="col">
                  {t('questionList.columns.question')}
                </th>
                <TableSortHeader
                  direction={
                    query.sort === 'LEVEL_ASC' ? 'ascending' : undefined
                  }
                  sortLabel={
                    query.sort === 'LEVEL_ASC'
                      ? t('questionList.sortLabels.levelActive')
                      : t('questionList.sortLabels.level')
                  }
                  onSort={() => setFilter('sort', 'LEVEL_ASC')}
                >
                  {t('questionList.columns.classification')}
                </TableSortHeader>
                <th className="px-4 py-3" scope="col">
                  {t('questionList.columns.status')}
                </th>
                <th className="px-4 py-3" scope="col">
                  {t('questionList.columns.attempts')}
                </th>
                <TableSortHeader
                  direction={
                    query.sort === 'REPORT_COUNT_DESC'
                      ? 'descending'
                      : undefined
                  }
                  sortLabel={
                    query.sort === 'REPORT_COUNT_DESC'
                      ? t('questionList.sortLabels.reportsActive')
                      : t('questionList.sortLabels.reports')
                  }
                  onSort={() => setFilter('sort', 'REPORT_COUNT_DESC')}
                >
                  {t('questionList.columns.reports')}
                </TableSortHeader>
                <TableSortHeader
                  direction={
                    query.sort === 'CREATED_DESC' ? 'descending' : undefined
                  }
                  sortLabel={
                    query.sort === 'CREATED_DESC'
                      ? t('questionList.sortLabels.createdActive')
                      : t('questionList.sortLabels.created')
                  }
                  onSort={() => setFilter('sort', 'CREATED_DESC')}
                >
                  {t('questionList.columns.createdAt')}
                </TableSortHeader>
                <TableSortHeader
                  direction={
                    query.sort === 'UPDATED_DESC' ? 'descending' : undefined
                  }
                  sortLabel={
                    query.sort === 'UPDATED_DESC'
                      ? t('questionList.sortLabels.updatedActive')
                      : t('questionList.sortLabels.updated')
                  }
                  onSort={() => setFilter('sort', 'UPDATED_DESC')}
                >
                  {t('questionList.columns.updatedAt')}
                </TableSortHeader>
                <th className="px-4 py-3" scope="col">
                  {t('questionList.columns.details')}
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
                        disabled={list.isFetching}
                        type="checkbox"
                        onChange={() => toggleSelection(item.questionId)}
                      />
                      <span className="sr-only">
                        {t('questionList.selectQuestion', {
                          question: item.questionTextPreview
                        })}
                      </span>
                    </label>
                  </td>
                  <th className="max-w-xl px-4 py-4 font-medium" scope="row">
                    <span className="line-clamp-2 break-words" lang="ja">
                      {item.questionTextPreview}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-muted">
                      {item.questionId}
                    </span>
                  </th>
                  <td className="px-4 py-4">
                    {item.level} · {t(adminSubjectKey[item.subject])}
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
                        {t(adminLifecycleStatusKey[item.lifecycleStatus])}
                      </Badge>
                      <Badge variant="info">
                        {t(adminVersionStatusKey[item.versionStatus])}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap tabular-nums">
                    {item.correctRateBasisPoints === null
                      ? t('questionList.noAccuracy', {
                          formattedCount: formatAdminNumber(item.answerCount)
                        })
                      : t('questionList.answerStats', {
                          formattedCount: formatAdminNumber(item.answerCount),
                          rate: formatAdminPercent(item.correctRateBasisPoints)
                        })}
                  </td>
                  <td className="px-4 py-4 tabular-nums">
                    {t('questionList.reportCount', {
                      formattedCount: formatAdminNumber(item.openReportCount)
                    })}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <time dateTime={item.createdAt}>
                      {formatAdminDateTime(item.createdAt)}
                    </time>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <time dateTime={item.updatedAt}>
                      {formatAdminDateTime(item.updatedAt)}
                    </time>
                  </td>
                  <td className="px-4 py-4">
                    <Link
                      className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-brand underline decoration-2 underline-offset-4 focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
                      to={`/admin/questions/${item.questionId}`}
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
            currentPage={page}
            disabled={list.isFetching || list.isError || isPaused}
            totalPages={totalPages}
            onPageChange={(nextPage) => setFilter('page', String(nextPage))}
          />
        </>
      )}

      <FreshAssuranceDialog controller={freshAssurance} />
    </section>
  )
}

import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import type { ReactElement } from 'react'
import { ArchiveQuestionDialog } from '@app/admin-question/components/ArchiveQuestionDialog'
import { BatchActionDialog } from '@app/admin-question/components/BatchActionDialog'
import {
  QuestionBatchResult,
  QuestionSelectionBar
} from '@app/admin-question/components/QuestionBatchBar'
import { QuestionListFilters } from '@app/admin-question/components/QuestionListFilters'
import { QuestionListTable } from '@app/admin-question/components/QuestionListTable'
import { useListAdminQuestions } from '@app/admin-question/hooks/useListAdminQuestions'
import { useQuestionArchive } from '@app/admin-question/hooks/useQuestionArchive'
import { useQuestionBatch } from '@app/admin-question/hooks/useQuestionBatch'
import {
  PAGE_SIZES,
  useQuestionListSearch
} from '@app/admin-question/hooks/useQuestionListSearch'
import {
  AdminListToolbar,
  adminListPageCount,
  type AdminListPaging
} from '@app/admin/components/list/AdminListToolbar'
import { Button } from '@nihongo/browser/common/components/Button'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Eyebrow } from '@nihongo/browser/common/components/Eyebrow'

export const AdminQuestionPage = (): ReactElement => {
  const { t } = useAdminPresentation()
  const location = useLocation()
  const filters = useQuestionListSearch()
  const {
    search,
    level,
    subject,
    status,
    difficulty,
    sort,
    page,
    pageSize,
    hasActiveFilters,
    searchParams,
    setSearchParams,
    setFilter
  } = filters
  const questionList = useListAdminQuestions({
    q: search || undefined,
    level,
    subject,
    versionStatus: status,
    lifecycleStatus: 'ACTIVE',
    difficulty,
    sort,
    page,
    pageSize
  })
  const archive = useQuestionArchive(questionList.refetch)
  const batch = useQuestionBatch(questionList.data?.items ?? [])
  // The publish button is gone once the result replaces the selection bar.
  const batchResultHeading = useRef<HTMLHeadingElement>(null)
  const listTop = useRef<HTMLDivElement>(null)

  const data = questionList.isError ? undefined : questionList.data
  const totalPages = data ? adminListPageCount(data.total, data.pageSize) : 1
  const isOutOfRangePage = Boolean(
    data && data.total > 0 && data.items.length === 0
  )
  const moving = questionList.isPlaceholderData || isOutOfRangePage

  useEffect(() => {
    if (!isOutOfRangePage || page <= totalPages) {
      return
    }

    const nextParams = new URLSearchParams(searchParams)
    if (totalPages === 1) {
      nextParams.delete('page')
    } else {
      nextParams.set('page', String(totalPages))
    }
    setSearchParams(nextParams, { replace: true })
  }, [isOutOfRangePage, page, searchParams, setSearchParams, totalPages])

  const paging: AdminListPaging = {
    total: data?.total,
    page,
    pageSize,
    pageSizes: PAGE_SIZES,
    disabled: moving,
    onPageChange: (nextPage) => setFilter('page', String(nextPage)),
    onPageSizeChange: (nextSize) => setFilter('pageSize', String(nextSize))
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-col gap-6 border-b border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <Eyebrow>{t('questionList.eyebrow')}</Eyebrow>
          <h1 className="mt-2 text-balance text-3xl font-black tracking-tight sm:text-4xl">
            {t('questionList.title')}
          </h1>
          <p className="mt-4 text-pretty leading-7 text-muted">
            {t('questionList.description')}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Link
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line bg-surface px-5 py-3 font-semibold text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            to="/questions/import"
          >
            {t('common.import')}
          </Link>
          <Link
            className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-lg bg-brand px-5 py-3 font-semibold text-white shadow-sm hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            to={`/questions/new?returnTo=${encodeURIComponent('/admin/questions' + location.search)}`}
          >
            {t('questionList.newQuestion')}
          </Link>
        </div>
      </div>

      {filters.unsupportedSort ? (
        <p role="status" className="mt-5 text-sm text-muted">
          {t('questionList.unsupportedSort')}
        </p>
      ) : null}
      <QuestionListFilters
        search={search}
        level={level}
        subject={subject}
        status={status}
        difficulty={difficulty}
        sort={sort}
        setFilter={setFilter}
        total={paging.total}
        onSearch={filters.handleSearch}
        onReset={filters.resetFilters}
      />

      <QuestionBatchResult batch={batch} headingRef={batchResultHeading} />

      <div className="mt-6">
        <AdminListToolbar
          position="top"
          paging={paging}
          anchorRef={listTop}
          leading={
            batch.selected.length > 0 ? (
              <QuestionSelectionBar batch={batch} />
            ) : undefined
          }
        />
      </div>

      {moving ? (
        <div className="relative h-0.5 overflow-hidden bg-brand-soft">
          <div className="absolute inset-y-0 left-0 w-1/3 animate-pulse bg-brand" />
          <p role="status" className="sr-only">
            {t('adminList.movingPage')}
          </p>
        </div>
      ) : null}

      {questionList.isPending ? (
        <LoadingState message={t('questionList.loading')} />
      ) : null}

      {questionList.isError ? (
        <ErrorState
          title={t('questionList.loadErrorTitle')}
          description={t('questionList.loadErrorDescription')}
          onRetry={() => void questionList.refetch()}
        />
      ) : null}

      {data && data.items.length === 0 && !isOutOfRangePage ? (
        <EmptyState
          className="rounded-card border border-line bg-surface"
          title={
            hasActiveFilters || search
              ? t('questionList.noMatchTitle')
              : t('questionList.noQuestionsTitle')
          }
          description={
            hasActiveFilters || search
              ? t('questionList.noMatchDescription')
              : t('questionList.noQuestionsDescription')
          }
          action={
            hasActiveFilters || search ? (
              <Button variant="outline" onClick={filters.clearSearchAndFilters}>
                {t('adminList.filters.reset')}
              </Button>
            ) : (
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                to={`/questions/new?returnTo=${encodeURIComponent('/admin/questions' + location.search)}`}
              >
                {t('questionList.firstQuestion')}
              </Link>
            )
          }
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          <QuestionListTable
            items={data.items}
            sort={sort}
            onArchive={archive.open}
            batch={batch}
          />
          <AdminListToolbar
            position="bottom"
            paging={paging}
            anchorRef={listTop}
          />
        </>
      ) : null}

      <ArchiveQuestionDialog archive={archive} />
      <BatchActionDialog batch={batch} fallbackFocusRef={batchResultHeading} />
    </section>
  )
}

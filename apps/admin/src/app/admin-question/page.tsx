import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import type { ReactElement } from 'react'
import { ArchiveQuestionDialog } from '@app/admin-question/components/ArchiveQuestionDialog'
import { BatchPublishDialog } from '@app/admin-question/components/BatchPublishDialog'
import { QuestionBatchBar } from '@app/admin-question/components/QuestionBatchBar'
import { QuestionListFilters } from '@app/admin-question/components/QuestionListFilters'
import { QuestionListTable } from '@app/admin-question/components/QuestionListTable'
import { useListAdminQuestions } from '@app/admin-question/hooks/useListAdminQuestions'
import { useQuestionArchive } from '@app/admin-question/hooks/useQuestionArchive'
import { useQuestionBatchPublish } from '@app/admin-question/hooks/useQuestionBatchPublish'
import { useQuestionListSearch } from '@app/admin-question/hooks/useQuestionListSearch'
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
    pageSize: 20
  })
  const archive = useQuestionArchive(questionList.refetch)
  const batch = useQuestionBatchPublish(questionList.data?.items ?? [])
  // The publish button is gone once the result replaces the selection bar.
  const batchResultHeading = useRef<HTMLHeadingElement>(null)

  const totalPages = questionList.data
    ? Math.max(
        1,
        Math.ceil(questionList.data.total / questionList.data.pageSize)
      )
    : 1
  const isOutOfRangePage = Boolean(
    questionList.data &&
      questionList.data.total > 0 &&
      questionList.data.items.length === 0
  )

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
        hasActiveFilters={hasActiveFilters}
        setFilter={setFilter}
        total={questionList.data?.total}
        onSearch={filters.handleSearch}
        onReset={filters.resetFilters}
      />

      <QuestionBatchBar batch={batch} headingRef={batchResultHeading} />

      {questionList.isPending ? (
        <LoadingState message={t('questionList.loading')} />
      ) : null}

      {questionList.isError ? (
        <div className="mt-8">
          <ErrorState
            title={t('questionList.loadErrorTitle')}
            description={t('questionList.loadErrorDescription')}
            onRetry={() => void questionList.refetch()}
          />
        </div>
      ) : null}

      {isOutOfRangePage ? (
        <LoadingState message={t('questionList.movingPage')} />
      ) : null}

      {questionList.data &&
      questionList.data.items.length === 0 &&
      !isOutOfRangePage ? (
        <EmptyState
          className="mt-8 rounded-2xl border border-line bg-white"
          title={
            hasActiveFilters
              ? t('questionList.noMatchTitle')
              : t('questionList.noQuestionsTitle')
          }
          description={
            hasActiveFilters
              ? t('questionList.noMatchDescription')
              : t('questionList.noQuestionsDescription')
          }
          action={
            hasActiveFilters ? (
              <Button variant="outline" onClick={() => setSearchParams({})}>
                {t('questionList.resetFilters')}
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

      {questionList.data && questionList.data.items.length > 0 ? (
        <QuestionListTable
          items={questionList.data.items}
          sort={sort}
          page={questionList.data.page}
          totalPages={totalPages}
          onPageChange={(nextPage) => setFilter('page', String(nextPage))}
          onArchive={archive.open}
          batch={batch}
        />
      ) : null}

      <ArchiveQuestionDialog archive={archive} />
      <BatchPublishDialog batch={batch} fallbackFocusRef={batchResultHeading} />
    </section>
  )
}

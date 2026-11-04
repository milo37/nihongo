import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { getAdminErrorKey } from '@app/admin/presentation/adminPresentation'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import {
  questionVersionStatusSchema,
  type QuestionVersionStatus
} from '@nihongo/contracts/admin/content-operations'
import { AppLink } from '@nihongo/browser/common/components/AppLink'
import { useAppStore } from '@nihongo/browser/store/index'
import { useEffect, useState } from 'react'
import { Link, useSearchParams, useLocation } from 'react-router'
import type { FormEvent, ReactElement } from 'react'
import type { ListAdminQuestionResponse } from '@api/admin-question/listAdminQuestion/schema'
import type {
  JlptLevel,
  QuestionDifficulty,
  QuestionSubject
} from '@nihongo/browser/common/types/domain'
import {
  LEVELS,
  QUESTION_DIFFICULTIES,
  SUBJECTS
} from '@nihongo/browser/common/types/domain'
import { useDeleteAdminQuestion } from '@app/admin-question/hooks/useDeleteAdminQuestion'
import { useListAdminQuestions } from '@app/admin-question/hooks/useListAdminQuestions'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { Input } from '@nihongo/browser/common/components/Input'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Pagination } from '@nihongo/browser/common/components/Pagination'
import { Select } from '@nihongo/browser/common/components/Select'
import { useToast } from '@nihongo/browser/common/components/Toast'

type AdminQuestionSummary = ListAdminQuestionResponse['items'][number]
type AdminQuestionSort = 'UPDATED_DESC' | 'LEVEL_ASC'

const SORTS: readonly AdminQuestionSort[] = ['UPDATED_DESC', 'LEVEL_ASC']

const LEVEL_SET: ReadonlySet<string> = new Set(LEVELS)
const SUBJECT_SET: ReadonlySet<string> = new Set(SUBJECTS)
const STATUS_SET: ReadonlySet<string> = new Set(
  questionVersionStatusSchema.options
)
const DIFFICULTY_SET: ReadonlySet<string> = new Set(QUESTION_DIFFICULTIES)
const SORT_SET: ReadonlySet<string> = new Set(SORTS)

const isJlptLevel = (value: string | null): value is JlptLevel => {
  return value !== null && LEVEL_SET.has(value)
}

const isQuestionSubject = (value: string | null): value is QuestionSubject => {
  return value !== null && SUBJECT_SET.has(value)
}

const isQuestionStatus = (
  value: string | null
): value is QuestionVersionStatus => {
  return value !== null && STATUS_SET.has(value)
}

const isQuestionDifficulty = (
  value: string | null
): value is QuestionDifficulty => {
  return value !== null && DIFFICULTY_SET.has(value)
}

const isAdminQuestionSort = (
  value: string | null
): value is AdminQuestionSort => {
  return value !== null && SORT_SET.has(value)
}

const parsePositiveInteger = (value: string | null): number => {
  const parsedValue = Number(value)
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 1
}

export const AdminQuestionPage = (): ReactElement => {
  const { t, formatAdminDateTime, presentError } = useAdminPresentation()
  const { locale } = useUiLocale()
  const formatUpdatedAt = (value: string): string =>
    Number.isNaN(new Date(value).getTime())
      ? t('questionList.noDate')
      : formatAdminDateTime(value)
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const actorId = useAppStore((state) => state.currentUser?.id)
  const [unsupportedSort] = useState(
    () => searchParams.get('sort') === 'STATUS'
  )
  const [archiveRefreshFailed, setArchiveRefreshFailed] = useState(false)
  const [questionToDelete, setQuestionToDelete] =
    useState<AdminQuestionSummary | null>(null)
  const deleteQuestion = useDeleteAdminQuestion()
  const { addToast } = useToast()
  const search = searchParams.get('search')?.trim() ?? ''
  const rawLevel = searchParams.get('level')
  const rawSubject = searchParams.get('subject')
  const rawStatus = searchParams.get('status')
  const rawDifficulty = searchParams.get('difficulty')
  const rawSort = searchParams.get('sort')
  const level = isJlptLevel(rawLevel) ? rawLevel : undefined
  const subject = isQuestionSubject(rawSubject) ? rawSubject : undefined
  const status = isQuestionStatus(rawStatus) ? rawStatus : undefined
  const difficulty = isQuestionDifficulty(rawDifficulty)
    ? rawDifficulty
    : undefined
  const sort = isAdminQuestionSort(rawSort)
    ? rawSort
    : rawSort === 'LEVEL'
      ? 'LEVEL_ASC'
      : 'UPDATED_DESC'
  const page = parsePositiveInteger(searchParams.get('page'))
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
  const hasActiveFilters = Boolean(
    search ||
      level ||
      subject ||
      status ||
      difficulty ||
      sort !== 'UPDATED_DESC'
  )

  useEffect(() => {
    if (!rawSort || isAdminQuestionSort(rawSort)) return
    const next = new URLSearchParams(searchParams)
    if (rawSort === 'LEVEL') next.set('sort', 'LEVEL_ASC')
    else next.delete('sort')
    if (rawSort !== 'LEVEL' && rawSort !== 'RECENT') next.delete('page')
    setSearchParams(next, { replace: true })
  }, [rawSort, searchParams, setSearchParams])
  const archiveError = deleteQuestion.apiError
  const needsFresh = archiveError?.code === 'FRESH_ASSURANCE_REQUIRED'
  const archiveConflict = archiveError?.code === 'VERSION_CONFLICT'
  const canEdit = (question: AdminQuestionSummary): boolean =>
    Boolean(actorId) &&
    question.lifecycleStatus === 'ACTIVE' &&
    question.author?.actorId === actorId &&
    ['DRAFT', 'CHANGES_REQUESTED'].includes(question.versionStatus)

  const setFilter = (key: string, value: string): void => {
    const nextParams = new URLSearchParams(searchParams)

    if (value.length === 0 || (key === 'sort' && value === 'UPDATED_DESC')) {
      nextParams.delete(key)
    } else {
      nextParams.set(key, value)
    }

    if (key !== 'page') {
      nextParams.delete('page')
    }

    setSearchParams(nextParams)
  }

  const handleSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const nextSearch = String(formData.get('search') ?? '').trim()
    setFilter('search', nextSearch)
  }

  const openDeleteDialog = (question: AdminQuestionSummary): void => {
    deleteQuestion.reset()
    setArchiveRefreshFailed(false)
    setQuestionToDelete(question)
  }

  const handleDeleteQuestion = async (): Promise<void> => {
    if (!questionToDelete) {
      return
    }

    try {
      await deleteQuestion.mutateAsync({
        questionId: questionToDelete.questionId,
        input: {
          expectedQuestionRowVersion: questionToDelete.questionRowVersion,
          expectedOpenCandidateVersionId:
            questionToDelete.openCandidateVersionId,
          expectedOpenCandidateRowVersion:
            questionToDelete.openCandidateVersionId
              ? questionToDelete.versionRowVersion
              : null
        }
      })
      addToast({
        title: t('questionList.archiveDialog.successTitle'),
        description: t('questionList.archiveDialog.successDescription', {
          questionId: questionToDelete.questionId
        }),
        variant: 'success'
      })
      setQuestionToDelete(null)
    } catch {
      // The dialog shows the error-code message below.
    }
  }

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

      {unsupportedSort ? (
        <p role="status" className="mt-5 text-sm text-muted">
          {t('questionList.unsupportedSort')}
        </p>
      ) : null}
      <div className="mt-8 rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-6">
        <form
          key={search}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          role="search"
          onSubmit={handleSearch}
        >
          <div className="min-w-0 flex-1">
            <Input
              name="search"
              label={t('questionList.searchLabel')}
              defaultValue={search}
              placeholder={t('questionList.searchPlaceholder')}
              autoComplete="off"
              // Contract q cap (phase7QuestionSearchSchema maxScalars 100).
              maxLength={100}
            />
          </div>
          <Button className="sm:mb-0" type="submit">
            {t('questionList.search')}
          </Button>
        </form>

        <fieldset className="mt-5 border-t border-line pt-5">
          <legend className="sr-only">{t('questionList.filtersLegend')}</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Select
              name="level"
              label={t('questionList.columns.level')}
              value={level ?? ''}
              onChange={(event) =>
                setFilter('level', event.currentTarget.value)
              }
            >
              <option value="">{t('questionList.allLevels')}</option>
              {LEVELS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            <Select
              name="subject"
              label={t('questionList.columns.subject')}
              value={subject ?? ''}
              onChange={(event) =>
                setFilter('subject', event.currentTarget.value)
              }
            >
              <option value="">{t('questionList.allSubjects')}</option>
              {SUBJECTS.map((value) => (
                <option key={value} value={value}>
                  {t(`enums.subjects.${value}`)}
                </option>
              ))}
            </Select>
            <Select
              name="status"
              label={t('questionList.columns.status')}
              value={status ?? ''}
              onChange={(event) =>
                setFilter('status', event.currentTarget.value)
              }
            >
              <option value="">{t('questionList.allStatuses')}</option>
              {questionVersionStatusSchema.options.map((value) => (
                <option key={value} value={value}>
                  {t(`enums.versionStatuses.${value}`)}
                </option>
              ))}
            </Select>
            <Select
              name="difficulty"
              label={t('questionList.columns.difficulty')}
              value={difficulty ?? ''}
              onChange={(event) =>
                setFilter('difficulty', event.currentTarget.value)
              }
            >
              <option value="">{t('questionList.allDifficulties')}</option>
              {QUESTION_DIFFICULTIES.map((value) => (
                <option key={value} value={value}>
                  {t(`enums.difficulties.${value}`)}
                </option>
              ))}
            </Select>
            <Select
              name="sort"
              label={t('questionList.sort')}
              value={sort}
              onChange={(event) => setFilter('sort', event.currentTarget.value)}
            >
              {SORTS.map((value) => (
                <option key={value} value={value}>
                  {t(`enums.questionSort.${value}`)}
                </option>
              ))}
            </Select>
          </div>
        </fieldset>

        <div className="mt-5 flex min-h-11 flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="text-sm text-muted" aria-live="polite">
            {questionList.data
              ? t('questionList.total', {
                  formattedCount: formatNumber(questionList.data.total, locale)
                })
              : t('questionList.totalPending')}
          </p>
          {hasActiveFilters ? (
            <button
              className="min-h-11 rounded-lg px-3 text-sm font-semibold text-brand underline underline-offset-4 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              type="button"
              onClick={() => setSearchParams({})}
            >
              {t('questionList.resetFilters')}
            </button>
          ) : null}
        </div>
      </div>

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
        <>
          <p
            className="mt-8 text-sm text-muted lg:sr-only"
            id="admin-question-table-help"
          >
            {t('questionList.tableHelp')}
          </p>
          <div
            className="mt-2 overflow-x-auto rounded-2xl border border-line bg-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            role="region"
            aria-label={t('questionList.tableLabel')}
            aria-describedby="admin-question-table-help"
            tabIndex={0}
          >
            <table className="w-full min-w-[76rem] border-collapse text-left text-sm">
              <caption className="sr-only">
                {t('questionList.tableCaption')}
              </caption>
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    {t('questionList.columns.id')}
                  </th>
                  <th
                    className="px-4 py-3 font-semibold"
                    scope="col"
                    aria-sort={sort === 'LEVEL_ASC' ? 'ascending' : undefined}
                  >
                    {t('questionList.columns.level')}
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    {t('questionList.columns.subject')}
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    {t('questionList.columns.questionType')}
                  </th>
                  <th className="w-[22rem] px-4 py-3 font-semibold" scope="col">
                    {t('questionList.columns.question')}
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    {t('questionList.columns.difficulty')}
                  </th>
                  <th
                    className="px-4 py-3 font-semibold"
                    scope="col"
                    aria-sort={undefined}
                  >
                    {t('questionList.columns.status')}
                  </th>
                  <th className="w-48 px-4 py-3 font-semibold" scope="col">
                    {t('questionList.columns.tags')}
                  </th>
                  <th
                    className="px-4 py-3 font-semibold"
                    scope="col"
                    aria-sort={
                      sort === 'UPDATED_DESC' ? 'descending' : undefined
                    }
                  >
                    {t('questionList.columns.updatedAt')}
                  </th>
                  <th
                    className="px-4 py-3 text-right font-semibold"
                    scope="col"
                  >
                    {t('questionList.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {questionList.data.items.map((question) => (
                  <tr
                    key={question.questionId}
                    className="align-top hover:bg-slate-50/80"
                  >
                    <th
                      className="max-w-40 px-4 py-4 font-mono text-xs font-semibold text-ink"
                      scope="row"
                    >
                      <Link
                        className="block break-all rounded-sm text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                        translate="no"
                        to={`/questions/${question.questionId}?returnTo=${encodeURIComponent('/admin/questions' + location.search)}`}
                      >
                        {question.questionId}
                      </Link>
                    </th>
                    <td className="px-4 py-4 font-bold">{question.level}</td>
                    <td className="px-4 py-4">
                      {t(`enums.subjects.${question.subject}`)}
                    </td>
                    <td className="px-4 py-4">
                      {t(`enums.questionTypes.${question.questionType}`)}
                    </td>
                    <td className="px-4 py-4">
                      <span className="line-clamp-2 leading-6">
                        {question.questionTextPreview}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {t(`enums.difficulties.${question.difficulty}`)}
                    </td>
                    <td className="px-4 py-4">
                      <Badge
                        variant={
                          question.versionStatus === 'PUBLISHED'
                            ? 'success'
                            : 'neutral'
                        }
                      >
                        {t(`enums.versionStatuses.${question.versionStatus}`)} ·{' '}
                        {t(
                          `questionList.lifecycle.${question.lifecycleStatus}`
                        )}{' '}
                        ·{' '}
                        {t(
                          question.currentPublishedVersionId
                            ? 'questionList.published'
                            : 'questionList.unpublished'
                        )}
                      </Badge>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex max-w-48 flex-wrap gap-1.5">
                        {question.tags.map((tag) => (
                          <Badge key={tag.id}>{tag.label}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 tabular-nums text-muted">
                      {formatUpdatedAt(question.updatedAt)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <Link
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-3 font-semibold text-ink hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                          to={`/questions/${question.questionId}${canEdit(question) ? '/edit' : ''}?returnTo=${encodeURIComponent('/admin/questions' + location.search)}`}
                          aria-label={t('questionList.rowActionLabel', {
                            questionId: question.questionId,
                            action: t(
                              canEdit(question)
                                ? 'questionList.edit'
                                : 'questionList.details'
                            )
                          })}
                        >
                          {t(
                            canEdit(question)
                              ? 'questionList.edit'
                              : 'questionList.details'
                          )}
                        </Link>
                        <button
                          className="min-h-11 rounded-lg border border-red-200 bg-white px-3 font-semibold text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                          type="button"
                          aria-label={t('questionList.archiveLabel', {
                            questionId: question.questionId
                          })}
                          onClick={() => openDeleteDialog(question)}
                        >
                          {t('questionList.archive')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            className="mt-8"
            currentPage={questionList.data.page}
            totalPages={totalPages}
            onPageChange={(nextPage) => setFilter('page', String(nextPage))}
          />
        </>
      ) : null}

      <Dialog
        open={questionToDelete !== null}
        title={t('questionList.archiveDialog.title')}
        description={
          questionToDelete
            ? t('questionList.archiveDialog.description', {
                questionId: questionToDelete.questionId
              })
            : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              disabled={deleteQuestion.isPending}
              onClick={() => setQuestionToDelete(null)}
            >
              {t('questionList.archiveDialog.cancel')}
            </Button>
            <Button
              variant="danger"
              isLoading={deleteQuestion.isPending}
              disabled={needsFresh || archiveConflict}
              loadingLabel={t('questionList.archiveDialog.confirming')}
              onClick={() => void handleDeleteQuestion()}
            >
              {t('questionList.archiveDialog.confirm')}
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open && !deleteQuestion.isPending) {
            setQuestionToDelete(null)
          }
        }}
      >
        <p className="leading-7 text-muted">
          {t('questionList.archiveDialog.body')}
        </p>
        {needsFresh ? (
          <AppLink
            to={`/login?redirect=${encodeURIComponent('/admin/questions' + location.search)}`}
            className="mt-4 inline-flex min-h-11 items-center font-semibold underline"
          >
            {t('questionList.archiveDialog.reauthenticate')}
          </AppLink>
        ) : null}
        {archiveConflict ? (
          <Button
            variant="secondary"
            onClick={() => {
              void questionList.refetch().then((result) => {
                if (result.isError || !result.data) {
                  setArchiveRefreshFailed(true)
                  return
                }
                const next = result.data.items.find(
                  (item) => item.questionId === questionToDelete?.questionId
                )
                setQuestionToDelete(next ?? null)
                deleteQuestion.reset()
                setArchiveRefreshFailed(false)
              })
            }}
          >
            {t('questionList.archiveDialog.refresh')}
          </Button>
        ) : null}
        {archiveRefreshFailed ? (
          <p role="alert">{t('questionList.archiveDialog.refreshFailed')}</p>
        ) : null}
        {deleteQuestion.isError ? (
          <p className="mt-4 text-sm font-semibold text-red-700" role="alert">
            {needsFresh
              ? t('questionList.archiveDialog.freshRequired')
              : archiveConflict
                ? t('questionList.archiveDialog.conflict')
                : getAdminErrorKey(deleteQuestion.error) === 'errors.generic'
                  ? t('questionList.archiveDialog.failed')
                  : presentError(deleteQuestion.error)}
          </p>
        ) : null}
      </Dialog>
    </section>
  )
}

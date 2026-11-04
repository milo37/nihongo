import { Badge } from '@nihongo/browser/common/components/Badge'
import { Pagination } from '@nihongo/browser/common/components/Pagination'
import { useAppStore } from '@nihongo/browser/store/index'
import { Link, useLocation } from 'react-router'
import type { ReactElement } from 'react'
import type { ListAdminQuestionResponse } from '@api/admin-question/listAdminQuestion/schema'
import type { AdminQuestionSort } from '@app/admin-question/hooks/useQuestionListSearch'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

export type AdminQuestionSummary = ListAdminQuestionResponse['items'][number]

type QuestionListTableProps = {
  items: AdminQuestionSummary[]
  sort: AdminQuestionSort
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  onArchive: (question: AdminQuestionSummary) => void
}

export const QuestionListTable = ({
  items,
  sort,
  page,
  totalPages,
  onPageChange,
  onArchive
}: QuestionListTableProps): ReactElement => {
  const { t, formatAdminDateTime } = useAdminPresentation()
  const location = useLocation()
  const actorId = useAppStore((state) => state.currentUser?.id)
  const formatUpdatedAt = (value: string): string =>
    Number.isNaN(new Date(value).getTime())
      ? t('questionList.noDate')
      : formatAdminDateTime(value)
  const canEdit = (question: AdminQuestionSummary): boolean =>
    Boolean(actorId) &&
    question.lifecycleStatus === 'ACTIVE' &&
    question.author?.actorId === actorId &&
    ['DRAFT', 'CHANGES_REQUESTED'].includes(question.versionStatus)

  return (
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
                aria-sort={sort === 'UPDATED_DESC' ? 'descending' : undefined}
              >
                {t('questionList.columns.updatedAt')}
              </th>
              <th className="px-4 py-3 text-right font-semibold" scope="col">
                {t('questionList.columns.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((question) => (
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
                    {t(`questionList.lifecycle.${question.lifecycleStatus}`)} ·{' '}
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
                      onClick={() => onArchive(question)}
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
        currentPage={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </>
  )
}

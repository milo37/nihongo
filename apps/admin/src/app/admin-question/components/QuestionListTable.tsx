import { Badge } from '@nihongo/browser/common/components/Badge'
import { Pagination } from '@nihongo/browser/common/components/Pagination'
import { useAppStore } from '@nihongo/browser/store/index'
import { Link, useLocation } from 'react-router'
import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { ListAdminQuestionResponse } from '@api/admin-question/listAdminQuestion/schema'
import type { AdminQuestionSort } from '@app/admin-question/hooks/useQuestionListSearch'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { hasPublicationHistory } from '@app/admin-question/detail/questionWorkflow'
import {
  isBatchPublishable,
  type QuestionBatchPublish
} from '@app/admin-question/hooks/useQuestionBatchPublish'

export type AdminQuestionSummary = ListAdminQuestionResponse['items'][number]

export const isDraftOnly = (question: AdminQuestionSummary): boolean =>
  !hasPublicationHistory(question.currentPublishedVersionId, [question])

type QuestionListTableProps = {
  items: AdminQuestionSummary[]
  sort: AdminQuestionSort
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  onArchive: (question: AdminQuestionSummary) => void
  batch: QuestionBatchPublish
}

// The select column stays pinned while the table scrolls sideways.
const selectCellClassName = 'sticky left-0 z-10 w-14 bg-white p-0'
const checkboxLabelClassName =
  'flex size-11 cursor-pointer items-center justify-center'
const checkboxClassName = 'size-4 accent-brand'

const PageCheckbox = ({
  batch,
  label,
  columnLabel
}: {
  readonly batch: QuestionBatchPublish
  readonly label: string
  readonly columnLabel: string
}): ReactElement => {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (input.current) input.current.indeterminate = batch.pageState === 'some'
  }, [batch.pageState])
  // A header cell keeps a name even when this page has nothing to select.
  if (batch.pageState === 'empty')
    return <span className="sr-only">{columnLabel}</span>
  return (
    <label className={checkboxLabelClassName}>
      <input
        ref={input}
        type="checkbox"
        className={checkboxClassName}
        aria-label={label}
        checked={batch.pageState === 'all'}
        onChange={batch.togglePage}
      />
    </label>
  )
}

const columnClassName = 'px-4 py-3 font-semibold'
type ColumnKey =
  | 'id'
  | 'level'
  | 'subject'
  | 'questionType'
  | 'question'
  | 'difficulty'
  | 'status'
  | 'tags'
  | 'updatedAt'
  | 'actions'
// Header cells after the select column; sort marks follow the server order.
const columns: ReadonlyArray<{
  key: ColumnKey
  className: string
  sortedBy?: { sort: AdminQuestionSort; direction: 'ascending' | 'descending' }
}> = [
  { key: 'id', className: columnClassName },
  {
    key: 'level',
    className: columnClassName,
    sortedBy: { sort: 'LEVEL_ASC', direction: 'ascending' }
  },
  { key: 'subject', className: columnClassName },
  { key: 'questionType', className: columnClassName },
  { key: 'question', className: `w-[22rem] ${columnClassName}` },
  { key: 'difficulty', className: columnClassName },
  { key: 'status', className: columnClassName },
  { key: 'tags', className: `w-48 ${columnClassName}` },
  {
    key: 'updatedAt',
    className: columnClassName,
    sortedBy: { sort: 'UPDATED_DESC', direction: 'descending' }
  },
  { key: 'actions', className: 'px-4 py-3 text-right font-semibold' }
]

/** Edit or details link and the archive or draft delete command. */
const QuestionRowActions = ({
  question,
  editable,
  returnTo,
  onArchive
}: {
  question: AdminQuestionSummary
  editable: boolean
  returnTo: string
  onArchive: (question: AdminQuestionSummary) => void
}): ReactElement => {
  const { t } = useAdminPresentation()
  const actionKey = editable ? 'questionList.edit' : 'questionList.details'
  const draftOnly = isDraftOnly(question)
  return (
    <td className="px-4 py-4">
      <div className="flex justify-end gap-2">
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-3 font-semibold text-ink hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          to={`/questions/${question.questionId}${editable ? '/edit' : ''}?returnTo=${returnTo}`}
          aria-label={t('questionList.rowActionLabel', {
            questionId: question.questionId,
            action: t(actionKey)
          })}
        >
          {t(actionKey)}
        </Link>
        <button
          className="min-h-11 rounded-lg border border-red-200 bg-white px-3 font-semibold text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          type="button"
          aria-label={t(
            draftOnly
              ? 'questionList.draftDeleteLabel'
              : 'questionList.archiveLabel',
            { questionId: question.questionId }
          )}
          onClick={() => onArchive(question)}
        >
          {t(draftOnly ? 'questionList.draftDelete' : 'questionList.archive')}
        </button>
      </div>
    </td>
  )
}

type QuestionRowProps = {
  question: AdminQuestionSummary
  actorId: string | undefined
  returnTo: string
  onArchive: (question: AdminQuestionSummary) => void
  batch: QuestionBatchPublish
}

const QuestionRow = ({
  question,
  actorId,
  returnTo,
  onArchive,
  batch
}: QuestionRowProps): ReactElement => {
  const { t, formatAdminDateTime } = useAdminPresentation()
  const editable =
    Boolean(actorId) &&
    question.lifecycleStatus === 'ACTIVE' &&
    question.author?.actorId === actorId &&
    ['DRAFT', 'CHANGES_REQUESTED'].includes(question.versionStatus)
  const updatedAt = Number.isNaN(new Date(question.updatedAt).getTime())
    ? t('questionList.noDate')
    : formatAdminDateTime(question.updatedAt)
  return (
    <tr className="align-top hover:bg-slate-50/80">
      <td className={selectCellClassName}>
        {isBatchPublishable(question) ? (
          <label className={checkboxLabelClassName}>
            <input
              type="checkbox"
              className={checkboxClassName}
              aria-label={t('questionList.batch.selectRow', {
                questionId: question.questionId
              })}
              checked={batch.isSelected(question.questionId)}
              onChange={() => batch.toggle(question.questionId)}
            />
          </label>
        ) : null}
      </td>
      <th
        className="max-w-40 px-4 py-4 font-mono text-xs font-semibold text-ink"
        scope="row"
      >
        <Link
          className="block break-all rounded-sm text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          translate="no"
          to={`/questions/${question.questionId}?returnTo=${returnTo}`}
        >
          {question.questionId}
        </Link>
      </th>
      <td className="px-4 py-4 font-bold">{question.level}</td>
      <td className="px-4 py-4">{t(`enums.subjects.${question.subject}`)}</td>
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
            question.versionStatus === 'PUBLISHED' ? 'success' : 'neutral'
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
        {updatedAt}
      </td>
      <QuestionRowActions
        question={question}
        editable={editable}
        returnTo={returnTo}
        onArchive={onArchive}
      />
    </tr>
  )
}

export const QuestionListTable = ({
  items,
  sort,
  page,
  totalPages,
  onPageChange,
  onArchive,
  batch
}: QuestionListTableProps): ReactElement => {
  const { t } = useAdminPresentation()
  const location = useLocation()
  const actorId = useAppStore((state) => state.currentUser?.id)
  const returnTo = encodeURIComponent('/admin/questions' + location.search)

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
              <th className={`${selectCellClassName} bg-slate-50`} scope="col">
                <PageCheckbox
                  batch={batch}
                  label={t('questionList.batch.selectPage')}
                  columnLabel={t('questionList.batch.selectColumn')}
                />
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.className}
                  scope="col"
                  aria-sort={
                    column.sortedBy?.sort === sort
                      ? column.sortedBy.direction
                      : undefined
                  }
                >
                  {t(`questionList.columns.${column.key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((question) => (
              <QuestionRow
                key={question.questionId}
                question={question}
                actorId={actorId}
                returnTo={returnTo}
                onArchive={onArchive}
                batch={batch}
              />
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

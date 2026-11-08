import { Badge } from '@nihongo/browser/common/components/Badge'
import { useAppStore } from '@nihongo/browser/store/index'
import { Link, useLocation, useNavigate } from 'react-router'
import { useEffect, useRef } from 'react'
import type { MouseEvent, ReactElement } from 'react'
import type { ListAdminQuestionResponse } from '@api/admin-question/listAdminQuestion/schema'
import type { AdminQuestionSort } from '@app/admin-question/hooks/useQuestionListSearch'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { hasPublicationHistory } from '@app/admin-question/detail/questionWorkflow'
import {
  isBatchSelectable,
  type QuestionBatch
} from '@app/admin-question/hooks/useQuestionBatch'
import {
  CopyIdButton,
  CopyStatus,
  useCopyText
} from '@app/admin/components/list/CopyIdButton'
import { RowActionMenu } from '@app/admin/components/list/RowActionMenu'
import { useWideLayout } from '@app/admin/components/list/useWideLayout'

export type AdminQuestionSummary = ListAdminQuestionResponse['items'][number]

export const isDraftOnly = (question: AdminQuestionSummary): boolean =>
  !hasPublicationHistory(question.currentPublishedVersionId, [question])

type QuestionListTableProps = {
  items: AdminQuestionSummary[]
  sort: AdminQuestionSort
  onArchive: (question: AdminQuestionSummary) => void
  batch: QuestionBatch
}

const checkboxLabelClassName =
  'flex size-11 cursor-pointer items-center justify-center'
const checkboxClassName = 'size-4 accent-brand'
const shortId = (id: string): string => id.slice(0, 8)

const PageCheckbox = ({
  batch,
  label,
  columnLabel
}: {
  readonly batch: QuestionBatch
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

type ColumnKey =
  | 'id'
  | 'level'
  | 'subjectType'
  | 'question'
  | 'difficulty'
  | 'status'
  | 'tags'
  | 'updatedAt'
  | 'actions'
// Fixed widths (U8); the question column takes what is left.
const columns: ReadonlyArray<{
  key: ColumnKey
  width?: string
  sortedBy?: { sort: AdminQuestionSort; direction: 'ascending' | 'descending' }
}> = [
  { key: 'id', width: 'w-[6.5rem]' },
  {
    key: 'level',
    width: 'w-16',
    sortedBy: { sort: 'LEVEL_ASC', direction: 'ascending' }
  },
  { key: 'subjectType', width: 'w-28' },
  { key: 'question' },
  { key: 'difficulty', width: 'w-[5.5rem]' },
  { key: 'status', width: 'w-28' },
  { key: 'tags', width: 'w-[8.5rem]' },
  {
    key: 'updatedAt',
    width: 'w-[5.5rem]',
    sortedBy: { sort: 'UPDATED_DESC', direction: 'descending' }
  },
  { key: 'actions', width: 'w-14' }
]

type QuestionItemProps = {
  question: AdminQuestionSummary
  onArchive: (question: AdminQuestionSummary) => void
  batch: QuestionBatch
}

/** Everything one row or card shows, worked out once. */
const useQuestionView = ({ question, onArchive }: QuestionItemProps) => {
  const { t, formatAdminDate, formatAdminDateTime } = useAdminPresentation()
  const location = useLocation()
  const navigate = useNavigate()
  const actorId = useAppStore((state) => state.currentUser?.id)
  const copy = useCopyText()
  const returnTo = encodeURIComponent('/admin/questions' + location.search)
  const detailHref = `/questions/${question.questionId}?returnTo=${returnTo}`
  const editable =
    Boolean(actorId) &&
    question.lifecycleStatus === 'ACTIVE' &&
    question.author?.actorId === actorId &&
    ['DRAFT', 'CHANGES_REQUESTED'].includes(question.versionStatus)
  const validDate = !Number.isNaN(new Date(question.updatedAt).getTime())
  // Only the exceptions get a second line under the status badge.
  const note =
    question.lifecycleStatus === 'ARCHIVED'
      ? t('questionList.archivedNote')
      : question.currentPublishedVersionId &&
          question.versionStatus !== 'PUBLISHED'
        ? t('questionList.published')
        : undefined

  return {
    selectable: isBatchSelectable(question, actorId),
    detailHref,
    // Whole row or card opens the details, except its own controls.
    onActivate: (event: MouseEvent<HTMLElement>): void => {
      if (!(event.target as Element).closest('a, button, input, label'))
        void navigate(detailHref)
    },
    updatedAt: validDate
      ? formatAdminDate(question.updatedAt)
      : t('questionList.noDate'),
    updatedAtTitle: validDate
      ? formatAdminDateTime(question.updatedAt)
      : undefined,
    status: (
      <>
        <Badge
          className="whitespace-nowrap"
          variant={
            question.versionStatus === 'PUBLISHED'
              ? 'success'
              : question.versionStatus === 'CHANGES_REQUESTED'
                ? 'warning'
                : 'neutral'
          }
        >
          {t(`enums.versionStatuses.${question.versionStatus}`)}
        </Badge>
        {note ? (
          <span className="mt-0.5 block whitespace-nowrap text-xs text-muted">
            {note}
          </span>
        ) : null}
      </>
    ),
    menu: (
      <>
        <RowActionMenu
          label={t('adminList.rowMenu', { id: question.questionId })}
          items={[
            editable
              ? {
                  key: 'edit',
                  label: t('questionList.edit'),
                  to: `/questions/${question.questionId}/edit?returnTo=${returnTo}`
                }
              : {
                  key: 'details',
                  label: t('questionList.details'),
                  to: detailHref
                },
            {
              key: 'copy',
              label: t('adminList.copyId'),
              onSelect: () => copy.copy(question.questionId)
            },
            'separator',
            {
              key: 'archive',
              label: t(
                isDraftOnly(question)
                  ? 'questionList.draftDelete'
                  : 'questionList.archive'
              ),
              danger: true,
              onSelect: () => onArchive(question)
            }
          ]}
        />
        <CopyStatus state={copy.state} />
      </>
    )
  }
}

const IdLink = ({
  questionId,
  href
}: {
  readonly questionId: string
  readonly href: string
}): ReactElement => (
  <Link
    className="whitespace-nowrap rounded-sm font-mono text-sm font-semibold text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
    translate="no"
    title={questionId}
    to={href}
  >
    <span aria-hidden="true">{shortId(questionId)}</span>
    <span className="sr-only">{questionId}</span>
  </Link>
)

const TagCell = ({
  tags
}: {
  readonly tags: AdminQuestionSummary['tags']
}): ReactElement | null => {
  const [first, ...rest] = tags
  if (!first) return null
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Badge className="block min-w-0 truncate" title={first.label}>
        {first.label}
      </Badge>
      {rest.length > 0 ? (
        <Badge
          className="shrink-0"
          title={rest.map((tag) => tag.label).join(', ')}
        >
          +{rest.length}
        </Badge>
      ) : null}
    </span>
  )
}

const RowCheckbox = ({
  question,
  batch
}: {
  readonly question: AdminQuestionSummary
  readonly batch: QuestionBatch
}): ReactElement => {
  const { t } = useAdminPresentation()
  return (
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
  )
}

const QuestionRow = (props: QuestionItemProps): ReactElement => {
  const { question, batch } = props
  const { t } = useAdminPresentation()
  const view = useQuestionView(props)
  return (
    <tr
      className="cursor-pointer hover:bg-surface-muted"
      onClick={view.onActivate}
    >
      <td className="p-0">
        {view.selectable ? (
          <RowCheckbox question={question} batch={batch} />
        ) : null}
      </td>
      {/* Named by the id alone; the copy button is not part of the header. */}
      <th
        className="px-2 py-3 text-left font-normal"
        scope="row"
        aria-label={question.questionId}
      >
        <span className="flex items-center">
          <IdLink questionId={question.questionId} href={view.detailHref} />
          <CopyIdButton id={question.questionId} />
        </span>
      </th>
      <td className="px-2 py-3">
        <Badge className="font-mono">{question.level}</Badge>
      </td>
      <td className="px-2 py-3">
        <span className="block whitespace-nowrap">
          {t(`enums.subjects.${question.subject}`)}
        </span>
        <span className="block whitespace-nowrap text-xs text-muted">
          {t(`enums.questionTypes.${question.questionType}`)}
        </span>
      </td>
      <td className="px-2 py-3">
        <span className="line-clamp-2 leading-6" lang="ja">
          {question.questionTextPreview}
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-3">
        {t(`enums.difficulties.${question.difficulty}`)}
      </td>
      <td className="px-2 py-3">{view.status}</td>
      <td className="px-2 py-3">
        <TagCell tags={question.tags} />
      </td>
      <td
        className="whitespace-nowrap px-2 py-3 tabular-nums text-muted"
        title={view.updatedAtTitle}
      >
        {view.updatedAt}
      </td>
      <td className="px-2 py-3 text-right">{view.menu}</td>
    </tr>
  )
}

const QuestionCard = (props: QuestionItemProps): ReactElement => {
  const { question, batch } = props
  const { t } = useAdminPresentation()
  const view = useQuestionView(props)
  return (
    <li
      className="cursor-pointer rounded-card border border-line bg-surface px-4 py-3"
      onClick={view.onActivate}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center">
          {view.selectable ? (
            <span className="-ml-3">
              <RowCheckbox question={question} batch={batch} />
            </span>
          ) : null}
          <IdLink questionId={question.questionId} href={view.detailHref} />
        </span>
        <span className="text-right">{view.status}</span>
      </div>
      <p className="mt-2 line-clamp-2 font-semibold leading-6" lang="ja">
        {question.questionTextPreview}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span>
          {[
            question.level,
            t(`enums.subjects.${question.subject}`),
            t(`enums.questionTypes.${question.questionType}`),
            t(`enums.difficulties.${question.difficulty}`)
          ].join(' · ')}
        </span>
        <TagCell tags={question.tags} />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span
          className="text-sm tabular-nums text-muted"
          title={view.updatedAtTitle}
        >
          {view.updatedAt}
        </span>
        {view.menu}
      </div>
    </li>
  )
}

/** Fixed-width table from 768px; cards below it. */
export const QuestionListTable = ({
  items,
  sort,
  onArchive,
  batch
}: QuestionListTableProps): ReactElement => {
  const { t } = useAdminPresentation()
  if (!useWideLayout())
    return (
      <ul className="grid gap-2" aria-label={t('questionList.tableLabel')}>
        {items.map((question) => (
          <QuestionCard
            key={question.questionId}
            question={question}
            onArchive={onArchive}
            batch={batch}
          />
        ))}
      </ul>
    )
  return (
    <div
      className="overflow-x-auto rounded-card border border-line bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      role="region"
      aria-label={t('questionList.tableLabel')}
      tabIndex={0}
    >
      <table className="w-full min-w-[69rem] table-fixed border-collapse text-left text-sm">
        <caption className="sr-only">{t('questionList.tableCaption')}</caption>
        <thead className="border-b border-line bg-surface-muted text-muted">
          <tr>
            <th className="w-11 p-0" scope="col">
              <PageCheckbox
                batch={batch}
                label={t('questionList.batch.selectPage')}
                columnLabel={t('questionList.batch.selectColumn')}
              />
            </th>
            {columns.map((column) => {
              const sorted = column.sortedBy?.sort === sort
              return (
                <th
                  key={column.key}
                  className={`${column.width ?? ''} whitespace-nowrap px-2 py-3 font-semibold`}
                  scope="col"
                  aria-sort={sorted ? column.sortedBy?.direction : undefined}
                >
                  {column.key === 'actions' ? (
                    <span className="sr-only">
                      {t('questionList.columns.actions')}
                    </span>
                  ) : (
                    t(`questionList.columns.${column.key}`)
                  )}
                  {sorted ? (
                    <span aria-hidden="true">
                      {column.sortedBy?.direction === 'ascending' ? ' ↑' : ' ↓'}
                    </span>
                  ) : null}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((question) => (
            <QuestionRow
              key={question.questionId}
              question={question}
              onArchive={onArchive}
              batch={batch}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

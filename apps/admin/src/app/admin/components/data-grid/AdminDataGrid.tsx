import { useEffect, useId, useRef, useState } from 'react'
import {
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable
} from '@tanstack/react-table'
import type {
  ColumnDef,
  ColumnVisibilityState,
  PaginationState,
  ReactTable,
  RowData,
  SortingState
} from '@tanstack/react-table'
import { AdminListIcon } from '@app/admin/components/list/AdminListIcon'
import { AdminListToolbar } from '@app/admin/components/list/AdminListToolbar'
import type { AdminListPaging } from '@app/admin/components/list/AdminListToolbar'
import { useWideLayout } from '@app/admin/components/list/useWideLayout'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import type { ReactElement, ReactNode } from 'react'

export const adminGridFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnVisibilityFeature
})
export type AdminGridFeatures = typeof adminGridFeatures

export const ADMIN_GRID_PAGE_SIZES = [25, 50, 100] as const

type AdminDataGridProps<TData extends RowData> = {
  readonly label: string
  readonly columns: readonly ColumnDef<AdminGridFeatures, TData>[]
  /** Width and alignment classes per column id (U8 fixed widths). */
  readonly columnClassNames?: Readonly<Record<string, string>>
  /**
   * Minimum table width: the fixed columns plus room for the flexible one.
   * Narrower screens scroll inside the table box, never the page.
   */
  readonly minTableWidth?: string
  readonly data: readonly TData[]
  readonly rowCount: number
  readonly getRowId: (row: TData) => string
  readonly sorting: SortingState
  readonly onSortingChange: (sorting: SortingState) => void
  readonly pagination: PaginationState
  readonly onPaginationChange: (pagination: PaginationState) => void
  readonly columnVisibility: ColumnVisibilityState
  readonly onColumnVisibilityChange: (visibility: ColumnVisibilityState) => void
  readonly emptyMessage: string
  /** Whole-row tap target; keep a real link in a cell for keyboard users. */
  readonly onRowActivate?: (row: TData) => void
  /** Card for one row below 768px, where the table is not shown. */
  readonly renderCard: (row: TData) => ReactNode
}

const resolve = <T,>(updater: T | ((previous: T) => T), previous: T): T =>
  typeof updater === 'function'
    ? (updater as (previous: T) => T)(previous)
    : updater

type GridTable<TData extends RowData> = ReactTable<AdminGridFeatures, TData>
type SortDirection = false | 'asc' | 'desc'

const ariaSortFor = (
  canSort: boolean,
  sorted: SortDirection
): 'ascending' | 'descending' | 'none' | undefined => {
  if (!canSort) return undefined
  if (sorted === 'asc') return 'ascending'
  if (sorted === 'desc') return 'descending'
  return 'none'
}

const sortIcon = (sorted: SortDirection): string =>
  sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'

/** `열` button with a checkbox popover for the columns that can be hidden. */
const ColumnPicker = <TData extends RowData>({
  table
}: {
  table: GridTable<TData>
}): ReactElement => {
  const { t } = useAdminPresentation()
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])
  return (
    <div
      ref={container}
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        setOpen(false)
        button.current?.focus()
      }}
    >
      <button
        ref={button}
        type="button"
        className="inline-flex min-h-11 items-center gap-1 rounded-control border border-line-interactive bg-surface px-3 text-sm font-semibold hover:border-line-strong focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {t('adminList.columns')}
        <AdminListIcon name="chevron-down" className="size-4" />
      </button>
      {open ? (
        <fieldset
          id={panelId}
          className="absolute right-0 top-full z-30 mt-1 grid min-w-48 rounded-control border border-line bg-surface px-3 py-1 shadow-elevated"
        >
          <legend className="sr-only">{t('adminList.columns')}</legend>
          {table
            .getAllLeafColumns()
            .filter((column) => column.getCanHide())
            .map((column) => (
              <label
                key={column.id}
                className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap text-sm"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-brand"
                  checked={column.getIsVisible()}
                  onChange={column.getToggleVisibilityHandler()}
                />
                {typeof column.columnDef.header === 'string'
                  ? column.columnDef.header
                  : column.id}
              </label>
            ))}
        </fieldset>
      ) : null}
    </div>
  )
}

/** Header row; sortable columns get a toggle button and arrow. */
const GridHead = <TData extends RowData>({
  table,
  columnClassNames
}: {
  table: GridTable<TData>
  columnClassNames: Readonly<Record<string, string>>
}): ReactElement => (
  <thead className="border-b border-line bg-surface-muted text-muted">
    {table.getHeaderGroups().map((group) => (
      <tr key={group.id}>
        {group.headers.map((header) => {
          const sorted = header.column.getIsSorted()
          const canSort = header.column.getCanSort()
          return (
            <th
              key={header.id}
              scope="col"
              aria-sort={ariaSortFor(canSort, sorted)}
              className={`whitespace-nowrap px-3 py-2 font-semibold ${columnClassNames[header.column.id] ?? ''}`}
            >
              {header.isPlaceholder ? null : canSort ? (
                <button
                  type="button"
                  onClick={header.column.getToggleSortingHandler()}
                  className="inline-flex min-h-11 items-center gap-1 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <table.FlexRender header={header} />
                  <span aria-hidden="true">{sortIcon(sorted)}</span>
                </button>
              ) : (
                <table.FlexRender header={header} />
              )}
            </th>
          )
        })}
      </tr>
    ))}
  </thead>
)

const activateUnlessControl =
  <TData,>(row: TData, onRowActivate?: (row: TData) => void) =>
  (event: { target: EventTarget }): void => {
    // Let links and buttons inside the row act on their own.
    if (onRowActivate && !(event.target as Element).closest('a, button, input'))
      onRowActivate(row)
  }

/** Rows, or one full-width empty row; optional whole-row activation. */
const GridBody = <TData extends RowData>({
  table,
  columnClassNames,
  emptyMessage,
  onRowActivate
}: {
  table: GridTable<TData>
  columnClassNames: Readonly<Record<string, string>>
  emptyMessage: string
  onRowActivate?: (row: TData) => void
}): ReactElement => {
  const rows = table.getRowModel().rows
  if (rows.length === 0)
    return (
      <tbody>
        <tr>
          <td
            colSpan={table.getVisibleLeafColumns().length}
            className="px-3 py-8 text-center text-muted"
          >
            {emptyMessage}
          </td>
        </tr>
      </tbody>
    )
  return (
    <tbody className="divide-y divide-line">
      {rows.map((row) => (
        <tr
          key={row.id}
          className={
            onRowActivate ? 'cursor-pointer hover:bg-surface-muted' : ''
          }
          onClick={
            onRowActivate
              ? activateUnlessControl(row.original, onRowActivate)
              : undefined
          }
        >
          {row.getVisibleCells().map((cell) => (
            <td
              key={cell.id}
              className={`h-16 whitespace-nowrap px-3 py-2 ${columnClassNames[cell.column.id] ?? ''}`}
            >
              <table.FlexRender cell={cell} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

/**
 * Server-driven data grid for admin lists: sorting and paging are reported to
 * the owner, which fetches the matching page. Rows are never processed here.
 * Below 768px the rows render as cards instead of the table.
 */
export const AdminDataGrid = <TData extends RowData>({
  label,
  columns,
  columnClassNames = {},
  minTableWidth = 'min-w-[48rem]',
  data,
  rowCount,
  getRowId,
  sorting,
  onSortingChange,
  pagination,
  onPaginationChange,
  columnVisibility,
  onColumnVisibilityChange,
  emptyMessage,
  onRowActivate,
  renderCard
}: AdminDataGridProps<TData>): ReactElement => {
  const wide = useWideLayout()
  const listTop = useRef<HTMLDivElement>(null)
  const table = useTable({
    features: adminGridFeatures,
    columns: columns as ColumnDef<AdminGridFeatures, TData>[],
    data: data as TData[],
    getRowId,
    manualSorting: true,
    manualPagination: true,
    rowCount,
    state: { sorting, pagination, columnVisibility },
    onSortingChange: (updater) => onSortingChange(resolve(updater, sorting)),
    onPaginationChange: (updater) =>
      onPaginationChange(resolve(updater, pagination)),
    onColumnVisibilityChange: (updater) =>
      onColumnVisibilityChange(resolve(updater, columnVisibility))
  })
  const paging: AdminListPaging = {
    total: rowCount,
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    pageSizes: ADMIN_GRID_PAGE_SIZES,
    onPageChange: (page) =>
      onPaginationChange({ ...pagination, pageIndex: page - 1 }),
    onPageSizeChange: (pageSize) =>
      onPaginationChange({ pageIndex: 0, pageSize })
  }

  return (
    <div>
      <AdminListToolbar
        position="top"
        paging={paging}
        anchorRef={listTop}
        trailing={wide ? <ColumnPicker table={table} /> : undefined}
      />
      {wide ? (
        <div
          role="region"
          aria-label={label}
          tabIndex={0}
          className="relative overflow-x-auto rounded-card border border-line bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <table
            className={`w-full ${minTableWidth} table-fixed border-collapse text-left text-sm`}
          >
            <caption className="sr-only">{label}</caption>
            <GridHead table={table} columnClassNames={columnClassNames} />
            <GridBody
              table={table}
              columnClassNames={columnClassNames}
              emptyMessage={emptyMessage}
              onRowActivate={onRowActivate}
            />
          </table>
        </div>
      ) : data.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-4 py-8 text-center text-muted">
          {emptyMessage}
        </p>
      ) : (
        <ul className="grid gap-2" aria-label={label}>
          {data.map((row) => (
            <li
              key={getRowId(row)}
              className={`rounded-card border border-line bg-surface px-4 py-3 ${onRowActivate ? 'cursor-pointer' : ''}`}
              onClick={activateUnlessControl(row, onRowActivate)}
            >
              {renderCard(row)}
            </li>
          ))}
        </ul>
      )}
      <AdminListToolbar position="bottom" paging={paging} anchorRef={listTop} />
    </div>
  )
}

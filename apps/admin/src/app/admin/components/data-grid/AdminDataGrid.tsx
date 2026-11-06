import { useId, useState } from 'react'
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
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import type { ReactElement } from 'react'

export const adminGridFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnVisibilityFeature
})
export type AdminGridFeatures = typeof adminGridFeatures

export const ADMIN_GRID_PAGE_SIZES = [25, 50, 100] as const

const COMPACT_QUERY = '(max-width: 760px)'

/**
 * Column visibility whose default depends on the viewport: on narrow screens
 * only `compactColumnIds` start visible; the rest can be turned on from the
 * column picker. The default is chosen once, so user choices are kept.
 */
export const useResponsiveColumnVisibility = (
  columnIds: readonly string[],
  compactColumnIds: readonly string[]
) =>
  useState<ColumnVisibilityState>(() =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(COMPACT_QUERY).matches
      ? Object.fromEntries(
          columnIds.map((id) => [id, compactColumnIds.includes(id)])
        )
      : {}
  )

type AdminDataGridProps<TData extends RowData> = {
  readonly label: string
  readonly columns: readonly ColumnDef<AdminGridFeatures, TData>[]
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

/** Collapsible picker for the columns that can be hidden. */
const ColumnPicker = <TData extends RowData>({
  table
}: {
  table: GridTable<TData>
}): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
        {t('grid.columns')}
      </summary>
      <fieldset className="mt-2 flex flex-wrap gap-x-4">
        <legend className="sr-only">{t('grid.columns')}</legend>
        {table
          .getAllLeafColumns()
          .filter((column) => column.getCanHide())
          .map((column) => (
            <label
              key={column.id}
              className="inline-flex min-h-11 items-center gap-2"
            >
              <input
                type="checkbox"
                className="size-4"
                checked={column.getIsVisible()}
                onChange={column.getToggleVisibilityHandler()}
              />
              {typeof column.columnDef.header === 'string'
                ? column.columnDef.header
                : column.id}
            </label>
          ))}
      </fieldset>
    </details>
  )
}

/** Sticky header row; sortable columns get a toggle button and arrow. */
const GridHead = <TData extends RowData>({
  table
}: {
  table: GridTable<TData>
}): ReactElement => (
  <thead>
    {table.getHeaderGroups().map((group) => (
      <tr key={group.id}>
        {group.headers.map((header, index) => {
          const sorted = header.column.getIsSorted()
          const canSort = header.column.getCanSort()
          return (
            <th
              key={header.id}
              scope="col"
              aria-sort={ariaSortFor(canSort, sorted)}
              className={`sticky top-0 whitespace-nowrap border-b border-line bg-surface px-2 py-2 font-semibold sm:px-3 ${index === 0 ? 'left-0 z-20' : 'z-10'}`}
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

/** Rows, or one full-width empty row; optional whole-row activation. */
const GridBody = <TData extends RowData>({
  table,
  emptyMessage,
  onRowActivate
}: {
  table: GridTable<TData>
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
    <tbody>
      {rows.map((row) => (
        <tr
          key={row.id}
          className={`border-b border-line last:border-0 ${onRowActivate ? 'cursor-pointer hover:bg-brand-soft' : ''}`}
          onClick={
            onRowActivate
              ? (event) => {
                  // Let links and buttons inside the row act on their own.
                  if (!(event.target as Element).closest('a, button, input'))
                    onRowActivate(row.original)
                }
              : undefined
          }
        >
          {row.getVisibleCells().map((cell, index) => (
            <td
              key={cell.id}
              className={`whitespace-nowrap px-2 py-2 sm:px-3 ${index === 0 ? 'sticky left-0 z-[1] bg-surface' : ''}`}
            >
              <table.FlexRender cell={cell} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

const pagerButtonClassName =
  'min-h-11 rounded-sm border border-line px-4 font-semibold disabled:text-disabled-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/** Page size, page status and previous/next buttons. */
const GridPager = <TData extends RowData>({
  table,
  pagination,
  rowCount,
  onPaginationChange
}: {
  table: GridTable<TData>
  pagination: PaginationState
  rowCount: number
  onPaginationChange: (pagination: PaginationState) => void
}): ReactElement => {
  const { t } = useAdminPresentation()
  const pageSizeId = useId()
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label htmlFor={pageSizeId}>{t('grid.pageSize')}</label>
      <select
        id={pageSizeId}
        className="min-h-11 rounded-sm border border-line bg-surface px-2"
        value={pagination.pageSize}
        onChange={(event) =>
          onPaginationChange({
            pageIndex: 0,
            pageSize: Number(event.target.value)
          })
        }
      >
        {ADMIN_GRID_PAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
      <p aria-live="polite" className="text-muted">
        {t('grid.pageStatus', {
          page: pagination.pageIndex + 1,
          pageCount: Math.max(1, table.getPageCount()),
          total: rowCount
        })}
      </p>
      <div className="ml-auto flex gap-2">
        <button
          type="button"
          disabled={!table.getCanPreviousPage()}
          onClick={() => table.previousPage()}
          className={pagerButtonClassName}
        >
          {t('grid.previous')}
        </button>
        <button
          type="button"
          disabled={!table.getCanNextPage()}
          onClick={() => table.nextPage()}
          className={pagerButtonClassName}
        >
          {t('grid.next')}
        </button>
      </div>
    </div>
  )
}

/**
 * Server-driven data grid for admin lists: sorting and paging are reported to
 * the owner, which fetches the matching page. Rows are never processed here.
 */
export const AdminDataGrid = <TData extends RowData>({
  label,
  columns,
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
  onRowActivate
}: AdminDataGridProps<TData>): ReactElement => {
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

  return (
    <div className="space-y-3">
      <ColumnPicker table={table} />
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="max-h-[70vh] overflow-auto rounded-sm border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <table className="w-full min-w-max border-collapse text-left text-sm">
          <caption className="sr-only">{label}</caption>
          <GridHead table={table} />
          <GridBody
            table={table}
            emptyMessage={emptyMessage}
            onRowActivate={onRowActivate}
          />
        </table>
      </div>
      <GridPager
        table={table}
        pagination={pagination}
        rowCount={rowCount}
        onPaginationChange={onPaginationChange}
      />
    </div>
  )
}

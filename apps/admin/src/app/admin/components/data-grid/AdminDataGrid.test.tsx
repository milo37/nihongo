import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { createColumnHelper } from '@tanstack/react-table'
import type {
  ColumnVisibilityState,
  PaginationState,
  SortingState
} from '@tanstack/react-table'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { AdminDataGrid } from '@app/admin/components/data-grid/AdminDataGrid'
import type { AdminGridFeatures } from '@app/admin/components/data-grid/AdminDataGrid'

// Test-only row shape; real admin lists use their shared contract types.
type Row = { id: string; name: string; count: number }
const helper = createColumnHelper<AdminGridFeatures, Row>()
const columns = helper.columns([
  helper.accessor('id', {
    header: 'ID',
    enableSorting: false,
    enableHiding: false
  }),
  helper.accessor('name', { header: '이름' }),
  helper.accessor('count', { header: '횟수' })
])

const onSorting = vi.fn<(value: SortingState) => void>()
const onPagination = vi.fn<(value: PaginationState) => void>()

const Harness = ({ rows, total }: { rows: Row[]; total: number }) => {
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25
  })
  const [visibility, setVisibility] = useState<ColumnVisibilityState>({})
  return (
    <AdminDataGrid
      label="테스트 목록"
      columns={columns}
      data={rows}
      rowCount={total}
      getRowId={(row) => row.id}
      sorting={sorting}
      onSortingChange={(value) => {
        onSorting(value)
        setSorting(value)
      }}
      pagination={pagination}
      onPaginationChange={(value) => {
        onPagination(value)
        setPagination(value)
      }}
      columnVisibility={visibility}
      onColumnVisibilityChange={setVisibility}
      emptyMessage="결과가 없습니다."
    />
  )
}

const renderGrid = (rows: Row[], total = rows.length) =>
  render(
    <I18nProvider>
      <Harness rows={rows} total={total} />
    </I18nProvider>
  )

beforeEach(() => {
  onSorting.mockReset()
  onPagination.mockReset()
})

it('reports header sorting with aria-sort and leaves unsortable columns plain', () => {
  renderGrid([{ id: 'a', name: '가', count: 1 }])
  const table = screen.getByRole('table', { name: '테스트 목록' })
  const idHeader = within(table).getByRole('columnheader', { name: 'ID' })
  expect(idHeader).not.toHaveAttribute('aria-sort')
  const nameHeader = within(table).getByRole('columnheader', { name: /이름/ })
  expect(nameHeader).toHaveAttribute('aria-sort', 'none')
  fireEvent.click(within(nameHeader).getByRole('button'))
  expect(onSorting).toHaveBeenLastCalledWith([
    { id: 'name', desc: expect.any(Boolean) }
  ])
  expect(nameHeader.getAttribute('aria-sort')).toMatch(/ascending|descending/)
})

it('hides a column from the column picker but not the fixed ID column', () => {
  renderGrid([{ id: 'a', name: '가', count: 1 }])
  expect(screen.queryByRole('checkbox', { name: 'ID' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '횟수' }))
  expect(
    screen.queryByRole('columnheader', { name: /횟수/ })
  ).not.toBeInTheDocument()
  expect(screen.getAllByRole('columnheader')).toHaveLength(2)
})

it('pages on the server: page size resets to the first page and buttons follow the total', () => {
  renderGrid([{ id: 'a', name: '가', count: 1 }], 60)
  expect(screen.getByText('1 / 3쪽 · 전체 60건')).toBeInTheDocument()
  const previous = screen.getByRole('button', { name: '이전' })
  const next = screen.getByRole('button', { name: '다음' })
  expect(previous).toBeDisabled()
  fireEvent.click(next)
  expect(onPagination).toHaveBeenLastCalledWith({ pageIndex: 1, pageSize: 25 })
  fireEvent.change(screen.getByLabelText('쪽당 행 수'), {
    target: { value: '50' }
  })
  expect(onPagination).toHaveBeenLastCalledWith({ pageIndex: 0, pageSize: 50 })
  expect(screen.getByText('1 / 2쪽 · 전체 60건')).toBeInTheDocument()
})

it('shows the empty message across the visible columns', () => {
  renderGrid([], 0)
  const cell = screen.getByRole('cell', { name: '결과가 없습니다.' })
  expect(cell).toHaveAttribute('colspan', '3')
  expect(screen.getByRole('button', { name: '다음' })).toBeDisabled()
})

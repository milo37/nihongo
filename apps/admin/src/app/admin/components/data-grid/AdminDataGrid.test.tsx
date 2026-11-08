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

const onRow = vi.fn<(row: Row) => void>()

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
      onRowActivate={onRow}
      renderCard={(row) => <p>{`카드 ${row.name}`}</p>}
    />
  )
}

const renderGrid = (rows: Row[], total = rows.length) =>
  render(
    <I18nProvider>
      <Harness rows={rows} total={total} />
    </I18nProvider>
  )

// The grid asks for (min-width: 768px), so a narrow screen does not match.
const setNarrow = (narrow: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(
      () =>
        ({
          matches: !narrow,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn()
        }) as unknown as MediaQueryList
    )
  )

beforeEach(() => {
  onSorting.mockReset()
  onPagination.mockReset()
  onRow.mockReset()
  setNarrow(false)
})
afterEach(() => vi.unstubAllGlobals())

it('shows cards instead of the table and column picker on narrow screens', () => {
  setNarrow(true)
  renderGrid([{ id: 'a', name: '가', count: 1 }])
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '열' })).not.toBeInTheDocument()
  const card = within(
    screen.getByRole('list', { name: '테스트 목록' })
  ).getByText('카드 가')
  fireEvent.click(card)
  expect(onRow).toHaveBeenCalledWith({ id: 'a', name: '가', count: 1 })
})

it('activates the whole row from any cell', () => {
  renderGrid([{ id: 'a', name: '가', count: 1 }])
  fireEvent.click(screen.getByRole('cell', { name: '가' }))
  expect(onRow).toHaveBeenCalledWith({ id: 'a', name: '가', count: 1 })
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
  const picker = screen.getByRole('button', { name: '열' })
  expect(picker).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(picker)
  expect(screen.queryByRole('checkbox', { name: 'ID' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '횟수' }))
  expect(
    screen.queryByRole('columnheader', { name: /횟수/ })
  ).not.toBeInTheDocument()
  expect(screen.getAllByRole('columnheader')).toHaveLength(2)
})

it('pages on the server: page size resets to the first page and buttons follow the total', () => {
  renderGrid([{ id: 'a', name: '가', count: 1 }], 60)
  const top = screen.getByRole('navigation', { name: '페이지 이동, 목록 위' })
  expect(
    screen.getByRole('navigation', { name: '페이지 이동, 목록 아래' })
  ).toBeInTheDocument()
  expect(screen.getAllByText('총 60개')).toHaveLength(2)
  expect(screen.getAllByText('· 1–25')).toHaveLength(2)
  expect(within(top).getByText('1 / 3')).toBeInTheDocument()
  expect(within(top).getByRole('button', { name: '첫 페이지' })).toBeDisabled()
  expect(
    within(top).getByRole('button', { name: '이전 페이지' })
  ).toBeDisabled()
  fireEvent.click(within(top).getByRole('button', { name: '다음 페이지' }))
  expect(onPagination).toHaveBeenLastCalledWith({ pageIndex: 1, pageSize: 25 })
  fireEvent.click(within(top).getByRole('button', { name: '마지막 페이지' }))
  expect(onPagination).toHaveBeenLastCalledWith({ pageIndex: 2, pageSize: 25 })
  fireEvent.change(
    screen.getAllByRole('combobox', { name: '한 페이지에' })[0] as HTMLElement,
    { target: { value: '50' } }
  )
  expect(onPagination).toHaveBeenLastCalledWith({ pageIndex: 0, pageSize: 50 })
  expect(within(top).getByText('1 / 2')).toBeInTheDocument()
})

it('shows the empty message across the visible columns', () => {
  renderGrid([], 0)
  const cell = screen.getByRole('cell', { name: '결과가 없습니다.' })
  expect(cell).toHaveAttribute('colspan', '3')
  expect(screen.getAllByText('총 0개')).toHaveLength(2)
  for (const next of screen.getAllByRole('button', { name: '다음 페이지' }))
    expect(next).toBeDisabled()
})

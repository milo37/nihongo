import { useRef, useState } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { AdminListFilters } from '@app/admin/components/list/AdminListFilters'
import { AdminListToolbar } from '@app/admin/components/list/AdminListToolbar'
import { CopyIdButton } from '@app/admin/components/list/CopyIdButton'
import type { AdminListFilter } from '@app/admin/components/list/FilterChip'
import { RowActionMenu } from '@app/admin/components/list/RowActionMenu'
import type { ReactElement, ReactNode } from 'react'

const wrap = (ui: ReactNode) =>
  render(
    <I18nProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </I18nProvider>
  )

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

afterEach(() => vi.unstubAllGlobals())

it('opens the row menu from the keyboard, moves between items and returns focus on Escape', async () => {
  const onArchive = vi.fn()
  const user = userEvent.setup()
  wrap(
    <RowActionMenu
      label="q-1 작업"
      items={[
        { key: 'details', label: '상세 보기', to: '/questions/q-1' },
        'separator',
        {
          key: 'archive',
          label: '초안 삭제',
          danger: true,
          onSelect: onArchive
        }
      ]}
    />
  )
  const button = screen.getByRole('button', { name: 'q-1 작업' })
  button.focus()
  await user.keyboard('{ArrowDown}')
  const menu = screen.getByRole('menu', { name: 'q-1 작업' })
  expect(
    within(menu).getByRole('menuitem', { name: '상세 보기' })
  ).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(
    within(menu).getByRole('menuitem', { name: '초안 삭제' })
  ).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(button).toHaveFocus()
  await user.keyboard('{Enter}')
  await user.click(screen.getByRole('menuitem', { name: '초안 삭제' }))
  expect(onArchive).toHaveBeenCalledOnce()
  expect(button).toHaveFocus()
})

const nextFrame = () =>
  act(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  )

it('keeps the row menu open through scrolling and a refetch, and closes once its button leaves the screen', async () => {
  const user = userEvent.setup()
  const menuFor = (label: string) => (
    <RowActionMenu
      label="q-1 작업"
      items={[{ key: 'archive', label, onSelect: vi.fn() }]}
    />
  )
  const { rerender } = wrap(menuFor('초안 삭제'))
  const button = screen.getByRole('button', { name: 'q-1 작업' })
  let top = 100
  vi.spyOn(button, 'getBoundingClientRect').mockImplementation(
    () => ({ top, bottom: top + 36, right: 900 }) as DOMRect
  )
  await user.click(button)
  const menu = screen.getByRole('menu', { name: 'q-1 작업' })
  expect(menu).toHaveStyle({ top: '140px' })

  // The page or the table scrolls: the menu follows its button.
  top = 60
  act(() => {
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
  })
  await nextFrame()
  expect(screen.getByRole('menu', { name: 'q-1 작업' })).toHaveStyle({
    top: '100px'
  })

  // A refetch redraws the same row with new data: the menu stays open.
  rerender(
    <I18nProvider>
      <MemoryRouter>{menuFor('보관')}</MemoryRouter>
    </I18nProvider>
  )
  expect(screen.getByRole('menuitem', { name: '보관' })).toBeInTheDocument()

  // Scrolled out of view: nothing left to point at, so it closes.
  top = -200
  act(() => window.dispatchEvent(new Event('scroll')))
  await nextFrame()
  expect(screen.queryByRole('menu')).toBeNull()
  expect(button).toHaveAttribute('aria-expanded', 'false')
})

it('copies the full id and announces it', async () => {
  const user = userEvent.setup()
  const writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  })
  wrap(<CopyIdButton id="10000000-0000-4000-8000-000000000001" />)
  await user.click(screen.getByRole('button', { name: 'ID 복사' }))
  expect(writeText).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000001')
  expect(await screen.findByRole('status')).toHaveTextContent('복사했어요')
})

const SheetHarness = (): ReactElement => {
  const [level, setLevel] = useState<string | undefined>()
  const filters: AdminListFilter[] = [
    {
      key: 'level',
      label: '급수',
      value: level,
      options: [
        { value: 'N5', label: 'N5' },
        { value: 'N4', label: 'N4' }
      ],
      onChange: setLevel
    }
  ]
  return (
    <AdminListFilters
      filters={filters}
      resultCount={level ? 3 : 10}
      onReset={() => setLevel(undefined)}
    />
  )
}

it('uses a bottom sheet on narrow screens where each pill applies at once', async () => {
  setNarrow(true)
  const user = userEvent.setup()
  wrap(<SheetHarness />)
  expect(screen.queryByRole('button', { name: /급수/ })).toBeNull()
  const open = screen.getByRole('button', { name: '필터' })
  await user.click(open)
  const sheet = screen.getByRole('dialog', { name: '필터' })
  await user.click(within(sheet).getByRole('radio', { name: 'N4' }))
  expect(within(sheet).getByRole('radio', { name: 'N4' })).toBeChecked()
  expect(screen.getByRole('button', { name: '필터 (1)' })).toBeInTheDocument()
  await user.click(within(sheet).getByRole('button', { name: '결과 3개 보기' }))
  expect(screen.getByRole('button', { name: '급수 필터 지우기' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: '급수 필터 지우기' }))
  expect(screen.getByRole('button', { name: '필터' })).toHaveFocus()
})

const ToolbarHarness = ({
  onPage
}: {
  onPage: (page: number) => void
}): ReactElement => {
  const anchor = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(2)
  const paging = {
    total: 105,
    page,
    pageSize: 20,
    pageSizes: [20, 100],
    onPageChange: (next: number) => {
      onPage(next)
      setPage(next)
    },
    onPageSizeChange: vi.fn()
  }
  return (
    <>
      <AdminListToolbar position="top" paging={paging} anchorRef={anchor} />
      <AdminListToolbar position="bottom" paging={paging} anchorRef={anchor} />
    </>
  )
}

it('shows the count and range and moves focus to the top toolbar after paging from below', async () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
  const onPage = vi.fn()
  wrap(<ToolbarHarness onPage={onPage} />)
  expect(screen.getAllByText('총 105개')).toHaveLength(2)
  expect(screen.getAllByText('· 21–40')).toHaveLength(2)
  const bottom = screen.getByRole('navigation', {
    name: '페이지 이동, 목록 아래'
  })
  act(() => {
    within(bottom).getByRole('button', { name: '마지막 페이지' }).click()
  })
  expect(onPage).toHaveBeenCalledWith(6)
  act(() => {
    vi.advanceTimersToNextFrame()
  })
  vi.useRealTimers()
  expect(
    screen.getAllByText('· 101–105')[0]?.parentElement?.parentElement
  ).toHaveFocus()
  expect(
    within(bottom).getByRole('button', { name: '다음 페이지' })
  ).toBeDisabled()
})

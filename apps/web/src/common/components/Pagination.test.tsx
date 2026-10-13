import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { Pagination } from '@common/components/Pagination'

afterEach(() => vi.unstubAllGlobals())

it.each([
  [7, 1, [1, 2, 3, 4, 5]],
  [7, 4, [2, 3, 4, 5, 6]],
  [7, 7, [3, 4, 5, 6, 7]],
  [4, 2, [1, 2, 3, 4]],
  [2, 1, [1, 2]],
  [1, 1, [1]],
  [7, 99, [3, 4, 5, 6, 7]]
] as const)(
  'shows consecutive real pages for total %s/current %s',
  (total, current, expected) => {
    render(
      <Pagination
        currentPage={current}
        totalPages={total}
        onPageChange={vi.fn()}
      />
    )
    expect(
      Array.from(
        document.querySelectorAll('.pagination-numbers button'),
        (node) => Number(node.textContent)
      )
    ).toEqual(expected)
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    expect(screen.queryByText('…')).not.toBeInTheDocument()
  }
)
it.each([0, -1, Number.NaN])('hides a nonexistent total %s', (total) => {
  render(
    <Pagination currentPage={1} totalPages={total} onPageChange={vi.fn()} />
  )
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})
it('keeps one real page with all four movement controls disabled', async () => {
  const change = vi.fn()
  render(<Pagination currentPage={1} totalPages={1} onPageChange={change} />)
  for (const label of [
    '첫 페이지',
    '이전 페이지',
    '다음 페이지',
    '마지막 페이지'
  ])
    expect(screen.getByRole('button', { name: label })).toBeDisabled()
  await userEvent.click(
    screen.getByRole('button', { name: '1페이지, 현재 페이지' })
  )
  expect(change).not.toHaveBeenCalled()
})
it('uses movement targets and locks every control while the source is unavailable', async () => {
  const change = vi.fn()
  const view = render(
    <Pagination currentPage={4} totalPages={7} onPageChange={change} />
  )
  for (const [label, target] of [
    ['첫 페이지', 1],
    ['이전 페이지', 3],
    ['다음 페이지', 5],
    ['마지막 페이지', 7]
  ] as const) {
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(change).toHaveBeenLastCalledWith(target)
  }
  view.rerender(
    <Pagination currentPage={4} totalPages={7} onPageChange={change} disabled />
  )
  expect(
    screen
      .getAllByRole('button')
      .every((button) => (button as HTMLButtonElement).disabled)
  ).toBe(true)
})
it('preserves modifier-link destinations and suppresses ordinary current-page navigation', () => {
  const change = vi.fn()
  render(
    <MemoryRouter>
      <Pagination
        currentPage={2}
        totalPages={7}
        onPageChange={change}
        getPageHref={(page) => `?view=SOLVED&page=${page}`}
      />
    </MemoryRouter>
  )
  const next = screen.getByRole('link', { name: '다음 페이지' })
  expect(next).toHaveAttribute('href', '/?view=SOLVED&page=3')
  // Observe the component's uncancelled modifier click, then contain jsdom navigation.
  let modifierWasAllowed = false
  document.addEventListener(
    'click',
    (event) => {
      modifierWasAllowed = !event.defaultPrevented
      event.preventDefault()
    },
    { once: true }
  )
  fireEvent.click(next, { ctrlKey: true })
  expect(modifierWasAllowed).toBe(true)
  expect(change).not.toHaveBeenCalled()
  expect(fireEvent.click(screen.getByRole('link', { current: 'page' }))).toBe(
    false
  )
  expect(change).not.toHaveBeenCalled()
})
it('focuses the new current number after a user action, preserving unrelated restore focus', async () => {
  const Harness = () => {
    const [page, setPage] = useState(1)
    return (
      <>
        <button type="button" onClick={() => setPage(1)}>
          restore
        </button>
        <Pagination
          currentPage={page}
          requestedPage={page}
          totalPages={7}
          onPageChange={setPage}
        />
      </>
    )
  }
  render(<Harness />)
  const next = screen.getByRole('button', { name: '다음 페이지' })
  next.focus()
  await userEvent.keyboard('{Enter}')
  expect(
    screen.getByRole('button', { name: '2페이지, 현재 페이지' })
  ).toHaveFocus()
  await userEvent.click(screen.getByRole('button', { name: 'restore' }))
  expect(screen.getByRole('button', { name: 'restore' })).toHaveFocus()
})
it('waits for the response and cancels a pending page focus when URL intent is reversed', async () => {
  const change = vi.fn()
  const view = render(
    <Pagination
      currentPage={1}
      requestedPage={1}
      totalPages={7}
      onPageChange={change}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: '다음 페이지' }))
  view.rerender(
    <Pagination
      currentPage={1}
      requestedPage={2}
      totalPages={7}
      onPageChange={change}
      disabled
    />
  )
  expect(screen.getByRole('button', { name: '다음 페이지' })).toHaveFocus()
  view.rerender(
    <Pagination
      currentPage={1}
      requestedPage={1}
      totalPages={7}
      onPageChange={change}
    />
  )
  view.rerender(
    <Pagination
      currentPage={2}
      requestedPage={2}
      totalPages={7}
      onPageChange={change}
    />
  )
  expect(
    screen.getByRole('button', { name: '2페이지, 현재 페이지' })
  ).not.toHaveFocus()
})
it('changes the actual DOM order at the mobile breakpoint without duplicating controls', () => {
  let mobile = false
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', () => ({
    matches: mobile,
    addEventListener: (_event: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) =>
      listeners.delete(listener)
  }))
  const view = render(
    <Pagination currentPage={4} totalPages={7} onPageChange={vi.fn()} />
  )
  const controls = document.querySelector('.pagination-controls')!
  expect(controls.firstElementChild).toHaveClass('pagination-previous')
  act(() => {
    mobile = true
    listeners.forEach((listener) => listener())
  })
  expect(controls.firstElementChild).toHaveClass('pagination-numbers')
  expect(screen.getAllByRole('button')).toHaveLength(9)
  view.unmount()
  expect(listeners.size).toBe(0)
})

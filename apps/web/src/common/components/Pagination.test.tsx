import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { Pagination } from '@common/components/Pagination'

describe('Pagination', () => {
  it('renders URL-backed pages as links without intercepting modified clicks', async () => {
    const onPageChange = vi.fn()
    const interaction = userEvent.setup()
    render(
      <MemoryRouter>
        <Pagination
          currentPage={1}
          getPageHref={(page) => `/items?page=${page}`}
          totalPages={3}
          onPageChange={onPageChange}
        />
      </MemoryRouter>
    )

    const next = screen.getByRole('link', { name: '다음 페이지' })
    expect(next).toHaveAttribute('href', '/items?page=2')
    expect(screen.getByRole('link', { name: /1.*현재/u })).toHaveAttribute(
      'aria-current',
      'page'
    )

    next.addEventListener('click', (event) => event.preventDefault(), {
      once: true
    })
    fireEvent.click(next, { ctrlKey: true })
    expect(onPageChange).not.toHaveBeenCalled()

    await interaction.click(next)
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('keeps URL controls mounted and focused while pagination is locked', async () => {
    const onPageChange = vi.fn()
    const interaction = userEvent.setup()
    const { rerender } = render(
      <MemoryRouter>
        <Pagination
          currentPage={1}
          getPageHref={(page) => `/items?page=${page}`}
          totalPages={2}
          onPageChange={onPageChange}
        />
      </MemoryRouter>
    )

    const next = screen.getByRole('link', { name: '다음 페이지' })
    next.focus()

    rerender(
      <MemoryRouter>
        <Pagination
          currentPage={1}
          disabled
          getPageHref={(page) => `/items?page=${page}`}
          totalPages={2}
          onPageChange={onPageChange}
        />
      </MemoryRouter>
    )

    const lockedNext = screen.getByRole('link', { name: '다음 페이지' })
    expect(lockedNext).toBe(next)
    expect(lockedNext).toHaveFocus()
    expect(lockedNext).toHaveAttribute('aria-disabled', 'true')
    expect(lockedNext).toHaveAttribute('href', '/items?page=1')
    expect(lockedNext).toHaveAttribute('tabindex', '-1')

    await interaction.keyboard('{Enter}')
    expect(onPageChange).not.toHaveBeenCalled()

    rerender(
      <MemoryRouter>
        <Pagination
          currentPage={1}
          getPageHref={(page) => `/items?page=${page}`}
          totalPages={2}
          onPageChange={onPageChange}
        />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: '다음 페이지' })).toBe(next)
    await interaction.keyboard('{Enter}')
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('keeps URL boundary controls inert without changing element type', async () => {
    const onPageChange = vi.fn()
    const interaction = userEvent.setup()
    render(
      <MemoryRouter>
        <Pagination
          currentPage={1}
          getPageHref={(page) => `/items?page=${page}`}
          totalPages={2}
          onPageChange={onPageChange}
        />
      </MemoryRouter>
    )

    const previous = screen.getByRole('link', { name: '이전 페이지' })
    expect(previous).toHaveAttribute('aria-disabled', 'true')
    expect(previous).toHaveAttribute('href', '/items?page=1')
    await interaction.click(previous)
    expect(onPageChange).not.toHaveBeenCalled()
  })
})

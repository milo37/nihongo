import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { SideNavigation } from '@common/components/SideNavigation'

it('renders only supplied destinations with one accessible current context', async () => {
  const navigate = vi.fn()
  render(
    <MemoryRouter>
      <SideNavigation
        id="supplied"
        label="main"
        brand={<span>brand</span>}
        items={[
          { to: '/practice', label: 'learn', icon: 'house' },
          {
            to: '/wrong-notes',
            label: 'review',
            icon: 'rotate-ccw',
            active: true
          }
        ]}
        onNavigate={navigate}
      />
    </MemoryRouter>
  )
  const nav = screen.getByRole('navigation', { name: 'main' })
  expect(nav).toHaveAttribute('id', 'supplied')
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))
  ).toEqual(['/practice', '/wrong-notes'])
  expect(within(nav).getByRole('link', { name: 'review' })).toHaveAttribute(
    'aria-current',
    'page'
  )
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  expect(nav.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2)
  await userEvent.click(within(nav).getByRole('link', { name: 'learn' }))
  expect(navigate).toHaveBeenCalledOnce()
})
it('adds no account or administrator destination to an empty supplied list', () => {
  render(
    <MemoryRouter>
      <SideNavigation
        id="empty"
        label="main"
        brand={<span>brand</span>}
        items={[]}
      />
    </MemoryRouter>
  )
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})

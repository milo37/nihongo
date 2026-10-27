import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AppShell } from '@nihongo/browser/common/components/AppShell'

it('composes supplied slots and preserves the main ref/skip target without owning focus', () => {
  const main = createRef<HTMLElement>()
  render(
    <AppShell
      sidebar={<nav aria-label="supplied sidebar" />}
      header={<header>utilities</header>}
      footer={<footer>information</footer>}
      bottomNavigation={<nav aria-label="supplied mobile" />}
      beforeMain={<a href="#content">skip</a>}
      mainProps={{ ref: main, id: 'content', tabIndex: -1 }}
    >
      <h1>content</h1>
    </AppShell>
  )
  expect(main.current).toBe(screen.getByRole('main'))
  expect(screen.getByRole('link')).toHaveAttribute('href', '#content')
  expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1')
  expect(screen.getByRole('main')).not.toHaveFocus()
  expect(screen.getAllByRole('navigation')).toHaveLength(2)
  expect(
    screen
      .getByRole('main')
      .compareDocumentPosition(screen.getByRole('contentinfo')) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
})
it('allows an owner to supply only focused-session content', () => {
  render(
    <AppShell className="app-shell-focus">
      <h1>question</h1>
    </AppShell>
  )
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByRole('banner')).not.toBeInTheDocument()
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  expect(screen.getByRole('main').closest('.app-shell')).toHaveClass(
    'app-shell-focus'
  )
})

import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { AdminNavigation } from '@app/admin/components/AdminNavigation'

const renderAt = (path: string) =>
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <AdminNavigation />
      </MemoryRouter>
    </I18nProvider>
  )

it.each([
  ['/questions', '문제'],
  ['/questions/q-1/edit', '문제'],
  ['/questions/import', '가져오기'],
  ['/reports/r-1', '버그 리포트'],
  ['/audit-log', '감사 이력']
])('marks only the current menu item for %s', (path, current) => {
  renderAt(path)
  const menu = screen.getByRole('navigation', { name: '관리자 메뉴' })
  const marked = within(menu)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
  expect(marked.map((link) => link.textContent)).toEqual([current])
  expect(within(menu).getByText('하루마루 관리')).toBeInTheDocument()
})

import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { DashboardPage } from '@app/dashboard/page'

const open = (entry: string) => {
  const router = createMemoryRouter(
    [
      { path: '/', element: <h1>홈</h1> },
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/wrong-notes', element: <h1>오답노트</h1> },
      { path: '/previous', element: <h1>이전</h1> }
    ],
    { initialEntries: ['/previous', entry], initialIndex: 1 }
  )
  render(<RouterProvider router={router} />)
  return router
}

// #978: home has one address; old links keep working.
it('sends an old /dashboard?view=learning link to / with its other conditions', async () => {
  const router = open(
    '/dashboard?level=N1&view=learning&subject=GRAMMAR#learning'
  )
  expect(await screen.findByRole('heading', { name: '홈' })).toBeVisible()
  expect(router.state.location.pathname).toBe('/')
  expect(router.state.location.search).toBe('?level=N1&subject=GRAMMAR')
  expect(router.state.location.hash).toBe('#learning')
  expect(router.state.historyAction).toBe('REPLACE')
  router.dispose()
})

it('still opens the wrong-answer notes from a bare /dashboard', async () => {
  const router = open('/dashboard')
  expect(await screen.findByRole('heading', { name: '오답노트' })).toBeVisible()
  expect(router.state.location.pathname).toBe('/wrong-notes')
  router.dispose()
})

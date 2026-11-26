import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { homeRoutes } from '@app/dashboard/router'

const auth = vi.hoisted(() => ({ isReady: true, role: 'USER' }))
vi.mock('@nihongo/browser/provider/ProtectedRouteProvider', () => ({
  useAuth: () => auth
}))
vi.mock('@app/home/page', () => ({ HomePage: () => <h1>손님 홈</h1> }))
vi.mock('@app/dashboard/page', () => ({ MemberHome: () => <h1>회원 홈</h1> }))

const open = () => {
  const router = createMemoryRouter(homeRoutes, {
    initialEntries: ['/?level=N5#learning']
  })
  render(<RouterProvider router={router} />)
  return router
}

// #978: one home address for guests and members, no /dashboard detour.
it.each([
  ['USER', '회원 홈'],
  ['ADMIN', '회원 홈'],
  ['GUEST', '손님 홈']
])('draws the %s home at / and stays there', async (role, heading) => {
  auth.role = role
  const router = open()
  expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
  expect(router.state.location.pathname).toBe('/')
  expect(router.state.location.search).toBe('?level=N5')
  router.dispose()
})

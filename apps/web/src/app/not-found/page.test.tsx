import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'
import { ForbiddenPage } from '@nihongo/browser/app/forbidden/page'
import { NotFoundPage } from '@nihongo/browser/app/not-found/page'
import { RouteErrorPage } from '@nihongo/browser/app/not-found/route-error'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'

const auth = vi.hoisted(() => ({ user: null as { name: string } | null }))
vi.mock('@nihongo/browser/provider/ProtectedRouteProvider', () => ({
  useAuth: () => ({ user: auth.user })
}))
beforeEach(() => {
  auth.user = null
})

it.each([false, true])(
  'keeps safe auth/learning recovery links for a forbidden visitor (member=%s)',
  (member) => {
    auth.user = member ? { name: 'member fixture' } : null
    const router = createMemoryRouter(
      [{ path: '*', element: <ForbiddenPage /> }],
      { initialEntries: ['/forbidden'] }
    )
    render(
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '이 페이지를 볼 권한이 없습니다'
    )
    expect(
      screen.getByRole('link', { name: '학습으로 돌아가기' })
    ).toHaveAttribute('href', '/practice')
    expect(
      screen.getByRole('link', {
        name: member ? '계정 확인' : '로그인으로 이동'
      })
    ).toHaveAttribute('href', '/login')
  }
)
it('keeps an unknown route distinct from a rendering error with a safe learning destination', () => {
  const router = createMemoryRouter(
    [{ path: '*', element: <NotFoundPage /> }],
    { initialEntries: ['/missing-route'] }
  )
  render(
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  )
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    '요청한 페이지가 없습니다'
  )
  expect(
    screen.getByRole('link', { name: '학습으로 돌아가기' })
  ).toHaveAttribute('href', '/practice')
})
it('renders a shell-independent fallback without disclosing the thrown error', async () => {
  const ThrowingShell = () => {
    throw new Error('private-fixture-token-and-internal-message')
  }
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: <ThrowingShell />,
        errorElement: <RouteErrorPage />
      }
    ],
    { initialEntries: ['/broken-layout'] }
  )
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined)
  try {
    render(
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    )
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      '화면을 불러오지 못했습니다'
    )
    expect(document.body).not.toHaveTextContent(
      'private-fixture-token-and-internal-message'
    )
    expect(
      screen.getByRole('link', { name: '학습으로 돌아가기' })
    ).toHaveAttribute('href', '/practice')
    expect(document.querySelector('.app-shell')).not.toBeInTheDocument()
  } finally {
    consoleError.mockRestore()
  }
})

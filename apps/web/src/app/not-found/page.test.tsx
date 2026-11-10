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
      '볼 수 없는 화면이에요'
    )
    expect(screen.getByRole('link', { name: '학습 화면으로' })).toHaveAttribute(
      'href',
      '/practice'
    )
    expect(
      screen.getByRole('link', {
        name: member ? '로그인하기' : '로그인하기'
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
    '없는 페이지예요'
  )
  expect(screen.getByRole('link', { name: '학습 화면으로' })).toHaveAttribute(
    'href',
    '/practice'
  )
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
      '화면을 불러오지 못했어요'
    )
    expect(document.body).not.toHaveTextContent(
      'private-fixture-token-and-internal-message'
    )
    expect(screen.getByRole('link', { name: '학습 화면으로' })).toHaveAttribute(
      'href',
      '/practice'
    )
    expect(document.querySelector('.app-shell')).not.toBeInTheDocument()
  } finally {
    consoleError.mockRestore()
  }
})

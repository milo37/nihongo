import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppLink } from '@nihongo/browser/common/components/AppLink'
import {
  appDocumentNavigation,
  getAppPath,
  resolveAppDestination,
  useAppNavigate
} from '@nihongo/browser/libs/appNavigation'
import { AuthErrorHandlerProvider } from '@nihongo/browser/provider/AuthErrorHandlerProvider'
import { emitApiError } from '@nihongo/browser/libs/errorBus'
import { queryClient } from '@nihongo/browser/libs/queryClient'

// Real router basename behavior plus a stub only at the full-document navigation boundary.
describe('web/admin document boundary', () => {
  it.each([
    ['/', '/admin/questions?page=2', true, '/admin/questions?page=2'],
    [
      '/admin/',
      '/login?redirect=%2Fadmin%2Fquestions',
      true,
      '/login?redirect=%2Fadmin%2Fquestions'
    ],
    ['/admin/', '/admin/questions/new', false, '/questions/new'],
    ['/admin/', '/admin', false, '/'],
    ['/', '/administrator', false, '/administrator']
  ])('resolves %s → %s', (base, path, crossApplication, localPath) => {
    expect(resolveAppDestination(path, base)).toEqual({
      crossApplication,
      path: localPath
    })
  })

  it('keeps the full admin return URL exactly once', () => {
    expect(getAppPath('/questions?level=N5&page=2', '/admin/')).toBe(
      '/admin/questions?level=N5&page=2'
    )
    expect(getAppPath('/admin/questions', '/admin/')).toBe('/admin/questions')
  })

  it('common admin shell links leave the basename for learner/account destinations', () => {
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <>
              <AppLink to="/practice">학습</AppLink>
              <AppLink to="/admin/questions/new">등록</AppLink>
            </>
          )
        }
      ],
      { basename: '/admin', initialEntries: ['/admin/questions'] }
    )
    render(<RouterProvider router={router} />)
    expect(screen.getByRole('link', { name: '학습' })).toHaveAttribute(
      'href',
      window.location.origin + '/practice'
    )
    expect(screen.getByRole('link', { name: '등록' })).toHaveAttribute(
      'href',
      '/admin/questions/new'
    )
  })

  it('member login return loads the admin document instead of the learner router', async () => {
    const replace = vi
      .spyOn(appDocumentNavigation, 'replace')
      .mockImplementation(() => undefined)
    const Entry = () => {
      const navigate = useAppNavigate()
      return (
        <button
          onClick={() =>
            void navigate('/admin/questions?level=N5&page=2', { replace: true })
          }
        >
          돌아가기
        </button>
      )
    }
    const router = createMemoryRouter([{ path: '*', element: <Entry /> }], {
      initialEntries: ['/login']
    })
    render(<RouterProvider router={router} />)
    act(() => screen.getByRole('button', { name: '돌아가기' }).click())
    expect(replace).toHaveBeenCalledWith(
      '/admin/questions?level=N5&page=2',
      undefined
    )
    expect(router.state.location.pathname).toBe('/login')
  })

  it('admin 401 keeps filters, clears private cache and carries the existing expiry notice to public login', async () => {
    const replace = vi
      .spyOn(appDocumentNavigation, 'replace')
      .mockImplementation(() => undefined)
    queryClient.setQueryData(['admin-question', 'private'], { cached: true })
    const router = createMemoryRouter(
      [{ path: '*', element: <AuthErrorHandlerProvider /> }],
      {
        basename: '/admin',
        initialEntries: ['/admin/questions?level=N5&page=2']
      }
    )
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    act(() =>
      emitApiError(
        Object.assign(new Error('Unauthorized'), {
          isAuthError: true,
          status: 401
        })
      )
    )
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        '/login?redirect=%2Fadmin%2Fquestions%3Flevel%3DN5%26page%3D2',
        { sessionExpired: true }
      )
    )
    expect(
      queryClient.getQueryData(['admin-question', 'private'])
    ).toBeUndefined()
    expect(router.state.location.pathname).toBe('/admin/questions')
  })
})

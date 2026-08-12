import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { emitApiError } from '@libs/errorBus'
import { queryClient } from '@libs/queryClient'
import { commitCanonicalAuth } from '@app/login/authSession'
import { AuthErrorHandlerProvider } from '@provider/AuthErrorHandlerProvider'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'

const renderProvider = (initialEntry = '/practice?mode=RANDOM') => {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: <AuthErrorHandlerProvider />
      }
    ],
    { initialEntries: [initialEntry] }
  )

  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  return { ...view, router }
}

describe('AuthErrorHandlerProvider', () => {
  it('전역 errorBus의 네트워크 오류를 접근 가능한 배너로 알린다', async () => {
    const user = userEvent.setup()
    renderProvider()

    act(() => {
      emitApiError(
        Object.assign(new Error('Network Error'), {
          isNetworkError: true,
          isOffline: false
        })
      )
    })

    const banner = screen.getByRole('status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    expect(banner).toHaveTextContent(
      '네트워크 연결이 원활하지 않습니다. 다시 시도해 주세요.'
    )

    await user.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('실제 offline에서 online으로 바뀔 때만 복구 상태를 다시 알린다', async () => {
    const user = userEvent.setup()
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)
    renderProvider()

    act(() => window.dispatchEvent(new Event('online')))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => window.dispatchEvent(new Event('offline')))
    expect(screen.getByRole('status')).toHaveTextContent('오프라인 상태입니다')

    await user.click(screen.getByRole('button', { name: '닫기' }))
    act(() => window.dispatchEvent(new Event('offline')))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => window.dispatchEvent(new Event('online')))
    expect(screen.getByRole('status')).toHaveAttribute('data-kind', 'restored')
    expect(screen.getByRole('status')).toHaveTextContent(
      '네트워크 연결이 복구된 것으로 감지했습니다'
    )
  })

  it('401에서 이전 사용자 cache와 practice를 지운 뒤 원래 경로를 보존한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    useAppStore
      .getState()
      .beginPractice('private-session', '2026-08-12T00:00:00.000Z')
    queryClient.setQueryData(['wrong-note', 'private'], {
      owner: currentUser.id
    })
    const { router } = renderProvider('/wrong-notes?status=NEW')

    act(() => {
      emitApiError(
        Object.assign(new Error('Unauthorized'), {
          isAuthError: true,
          status: 401
        })
      )
    })

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toBe(
      '?redirect=%2Fwrong-notes%3Fstatus%3DNEW'
    )
    expect(queryClient.getQueryData(['wrong-note', 'private'])).toBeUndefined()
    expect(useAppStore.getState().currentUser).toBeNull()
    expect(useAppStore.getState().sessionId).toBeNull()
  })

  it('더 최신 인증 전환이 401을 대체하면 오래된 login 이동을 실행하지 않는다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const { router } = renderProvider('/practice?mode=RANDOM')
    const originalCancelQueries = queryClient.cancelQueries.bind(queryClient)
    let releaseFirstCancellation: (() => void) | undefined
    let cancellationCount = 0
    const firstCancellation = new Promise<void>((resolve) => {
      releaseFirstCancellation = resolve
    })
    vi.spyOn(queryClient, 'cancelQueries').mockImplementation(
      async (filters, options) => {
        cancellationCount += 1
        if (cancellationCount === 1) {
          await firstCancellation
          return
        }
        return originalCancelQueries(filters, options)
      }
    )

    act(() => {
      emitApiError(
        Object.assign(new Error('Superseded unauthorized response'), {
          isAuthError: true,
          status: 401
        })
      )
    })
    await waitFor(() => expect(cancellationCount).toBe(1))

    const admin = mockDatabase.loginAs('ADMIN')
    await commitCanonicalAuth(queryClient, admin, {
      forceClear: true,
      forcePracticeReset: true
    })
    releaseFirstCancellation?.()

    await waitFor(() =>
      expect(useAppStore.getState().currentUser?.role).toBe('ADMIN')
    )
    expect(router.state.location.pathname).toBe('/practice')
  })

  it('403은 auth, cache, practice를 유지하고 forbidden으로 이동한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    useAppStore
      .getState()
      .beginPractice('active-session', '2026-08-12T00:00:00.000Z')
    queryClient.setQueryData(['dashboard', 'private'], {
      owner: currentUser.id
    })
    const { router } = renderProvider('/admin/questions')

    act(() => {
      emitApiError(
        Object.assign(new Error('Forbidden'), {
          isForbiddenError: true,
          status: 403
        })
      )
    })

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/forbidden')
    )
    expect(queryClient.getQueryData(['dashboard', 'private'])).toEqual({
      owner: currentUser.id
    })
    expect(useAppStore.getState().currentUser?.id).toBe(currentUser.id)
    expect(useAppStore.getState().sessionId).toBe('active-session')
  })

  it('unmount 시 online과 offline listener를 정리한다', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const view = renderProvider()

    view.unmount()

    for (const eventName of ['online', 'offline']) {
      const added = addEventListener.mock.calls.find(
        ([type]) => type === eventName
      )
      expect(added).toBeDefined()
      expect(removeEventListener).toHaveBeenCalledWith(eventName, added?.[1])
    }
  })
})

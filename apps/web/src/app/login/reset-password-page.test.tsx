import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { ResetPasswordPage } from '@app/login/reset-password-page'
import { queryClient } from '@libs/queryClient'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const renderPage = (entry: string): void => {
  window.history.replaceState({}, '', entry)
  const router = createMemoryRouter(
    [
      {
        path: '/reset-password',
        element: <ResetPasswordPage />
      },
      {
        path: '/login',
        element: <p>로그인 도착</p>
      }
    ],
    { initialEntries: [entry] }
  )

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('ResetPasswordPage', () => {
  it('token이 없으면 새 링크 요청을 안내한다', () => {
    renderPage('/reset-password')

    expect(
      screen.getByRole('heading', { name: '유효하지 않은 재설정 링크' })
    ).toBeInTheDocument()
  })

  it('새 password를 제출하고 기존 session 폐기를 안내한다', async () => {
    mockServer.use(
      http.post('*/api/auth/reset-password', () => {
        mockDatabase.logout()
        return HttpResponse.json({ success: true as const })
      })
    )
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    useAppStore
      .getState()
      .beginPractice('private-session', '2026-08-14T00:00:00.000Z')
    queryClient.setQueryData(['wrong-note', 'private'], {
      owner: currentUser.id
    })
    renderPage('/reset-password#token=valid-test-token')

    expect(window.location.hash).toBe('')

    await user.type(screen.getByLabelText('새 비밀번호'), 'Next-password-2026!')
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }))

    const heading = await screen.findByRole('heading', {
      name: '비밀번호를 변경했습니다'
    })
    expect(
      screen.getByText(/기존 로그인 세션은 모두 종료했습니다/u)
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(heading).toHaveFocus())
    expect(useAppStore.getState().currentUser).toBeNull()
    expect(useAppStore.getState().sessionId).toBeNull()
    expect(queryClient.getQueryData(['wrong-note', 'private'])).toBeUndefined()
  })

  it('Mock 미지원 응답을 만료 링크로 오표시하지 않는다', async () => {
    const user = userEvent.setup()
    renderPage('/reset-password#token=mock-token')

    await user.type(screen.getByLabelText('새 비밀번호'), 'Next-password-2026!')
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }))

    expect(
      await screen.findByText(
        /Mock 모드에서는 비밀번호 재설정을 지원하지 않습니다/u
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/링크가 만료/u)).not.toBeInTheDocument()
  })
})

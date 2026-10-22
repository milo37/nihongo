import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { ResetPasswordPage } from '@app/login/reset-password-page'
import { LoginPage } from '@app/login/page'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { queryClient } from '@libs/queryClient'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const apiModeFixture = vi.hoisted(() => ({ isMockApiMode: true }))
vi.mock('@libs/apiMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@libs/apiMode')>()
  return {
    ...actual,
    get isMockApiMode() {
      return apiModeFixture.isMockApiMode
    }
  }
})
afterEach(() => {
  apiModeFixture.isMockApiMode = true
})

const renderPage = (entry: string): ReturnType<typeof createMemoryRouter> => {
  window.history.replaceState({}, '', entry)
  const router = createMemoryRouter(
    [
      {
        path: '/reset-password',
        element: (
          <ProtectedRouteProvider>
            <ResetPasswordPage />
          </ProtectedRouteProvider>
        )
      },
      {
        path: '/login',
        element: (
          <ProtectedRouteProvider>
            <LoginPage />
          </ProtectedRouteProvider>
        )
      }
    ],
    { initialEntries: [entry] }
  )

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

describe('ResetPasswordPage', () => {
  it('token이 없으면 원래 메일 링크를 안내하고 체험 환경의 미지원 요청을 약속하지 않는다', async () => {
    renderPage('/reset-password')

    expect(
      screen.getByRole('heading', { name: '유효하지 않은 재설정 링크' })
    ).toBeInTheDocument()
    const link = await screen.findByRole('link', { name: '로그인·계정 확인' })
    expect(link).toHaveAttribute('href', '/login')
    expect(
      screen.getByText(/원래 재설정 링크를 다시 열어/u)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '재설정 링크 요청' })
    ).not.toBeInTheDocument()
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
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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

it('지원 모드의 게스트 복구 링크가 기존 재설정 요청 폼에 도착한다', async () => {
  apiModeFixture.isMockApiMode = false
  const user = userEvent.setup()
  const router = renderPage('/reset-password')
  await user.click(
    await screen.findByRole('link', { name: '재설정 링크 요청' })
  )
  expect(
    await screen.findByRole('heading', { name: '비밀번호 재설정' })
  ).toBeInTheDocument()
  expect(screen.getByLabelText('이메일')).toBeInTheDocument()
  expect(router.state.location.search).toBe('?mode=reset')
  expect(mockDatabase.getCurrentUser()).toBeNull()
})

it('지원 모드의 회원은 계정 확인 후 직접 로그아웃해야 기존 재설정 요청 폼을 연다', async () => {
  apiModeFixture.isMockApiMode = false
  const user = userEvent.setup()
  const member = mockDatabase.loginAs('USER')
  useAppStore.getState().setCurrentUser(member)
  const router = renderPage('/reset-password')
  await user.click(await screen.findByRole('link', { name: '계정 확인·전환' }))
  expect(
    await screen.findByRole('heading', { name: '로그인되어 있어요' })
  ).toBeInTheDocument()
  expect(mockDatabase.getCurrentUser()?.id).toBe(member.id)
  expect(
    screen.queryByRole('button', { name: '게스트로 계속' })
  ).not.toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: '로그아웃하고 다른 계정으로 로그인' })
  )
  expect(
    await screen.findByRole('heading', { name: '비밀번호 재설정' })
  ).toBeInTheDocument()
  expect(screen.getByLabelText('이메일')).toBeInTheDocument()
  expect(router.state.location.search).toBe('?mode=reset')
  expect(mockDatabase.getCurrentUser()).toBeNull()
})

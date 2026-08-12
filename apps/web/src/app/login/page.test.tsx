import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { loginDemoUser } from '@api/auth/loginDemoUser'
import { listWrongNote } from '@api/wrong-note/listWrongNote'
import { createStudySession } from '@api/study/createStudySession'
import { submitStudySession } from '@api/study/submitStudySession'
import { LoginPage } from '@app/login/page'
import { queryClient } from '@libs/queryClient'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'

const renderLoginPage = (redirect = '/practice'): void => {
  const router = createMemoryRouter(
    [
      {
        path: '/login',
        element: (
          <ProtectedRouteProvider>
            <LoginPage />
          </ProtectedRouteProvider>
        )
      },
      {
        path: '/practice',
        element: <p>학습 설정 도착</p>
      },
      {
        path: '/',
        element: <p>홈 도착</p>
      }
    ],
    { initialEntries: [`/login?redirect=${encodeURIComponent(redirect)}`] }
  )

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('LoginPage role transition', () => {
  it('게스트 전환 시 Mock 인증도 로그아웃하여 학습 결과를 저장하지 않는다', async () => {
    const user = userEvent.setup()
    const demoUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(demoUser)
    renderLoginPage()

    await user.click(screen.getByRole('button', { name: '게스트로 계속' }))
    expect(await screen.findByText('학습 설정 도착')).toBeInTheDocument()
    expect(mockDatabase.getCurrentUser()).toBeNull()
    expect(useAppStore.getState().currentUser).toBeNull()

    const sessionPayload = await createStudySession({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    expect(sessionPayload.session.userId).toBeNull()
    await submitStudySession(sessionPayload.session.id, {
      answers: [],
      durationSec: 10
    })

    await loginDemoUser()
    const wrongNotes = await listWrongNote()
    expect(wrongNotes.total).toBe(0)
  })

  it('역할을 바꾸면 이전 사용자의 Query cache를 제거한다', async () => {
    const user = userEvent.setup()
    const demoUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(demoUser)
    queryClient.setQueryData(['wrong-note', 'list-wrong-notes'], {
      owner: 'demo-user'
    })
    renderLoginPage()

    await user.click(
      screen.getByRole('button', { name: '데모 관리자로 로그인' })
    )

    expect(await screen.findByText('학습 설정 도착')).toBeInTheDocument()
    expect(
      queryClient.getQueryData(['wrong-note', 'list-wrong-notes'])
    ).toBeUndefined()
    expect(
      queryClient.getQueryData(['auth', 'get-current-user'])
    ).toMatchObject({ role: 'ADMIN' })
    expect(useAppStore.getState().currentUser?.role).toBe('ADMIN')
    expect(mockDatabase.getCurrentUser()?.role).toBe('ADMIN')
  })

  it('게스트가 보호 경로로 되돌아가지 않도록 홈으로 안내한다', async () => {
    const user = userEvent.setup()
    renderLoginPage('/dashboard')

    await user.click(screen.getByRole('button', { name: '게스트로 계속' }))

    expect(await screen.findByText('홈 도착')).toBeInTheDocument()
  })

  it('게스트가 다른 사용자의 세션 URL 대신 학습 설정으로 이동한다', async () => {
    const user = userEvent.setup()
    renderLoginPage('/practice/session/user-session')

    await user.click(screen.getByRole('button', { name: '게스트로 계속' }))

    expect(await screen.findByText('학습 설정 도착')).toBeInTheDocument()
  })
})

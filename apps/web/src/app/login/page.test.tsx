import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { signInUser } from '@api/auth/signInUser'
import { listWrongNote } from '@api/wrong-note/listWrongNote'
import { createStudySession } from '@api/study/createStudySession'
import { submitStudySession } from '@api/study/submitStudySession'
import { LoginPage } from '@app/login/page'
import { LocaleSwitcher } from '@common/components/LocaleSwitcher'
import { queryClient } from '@libs/queryClient'
import { DEMO_REVIEWER_ADMIN_ID } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { I18nProvider } from '@provider/I18nProvider'
import { useAppStore } from '@store/index'

const renderLoginPage = (
  redirect = '/practice',
  withLocaleSwitcher = false
): ReturnType<typeof createMemoryRouter> => {
  const router = createMemoryRouter(
    [
      {
        path: '/login',
        element: (
          <ProtectedRouteProvider>
            {withLocaleSwitcher ? <LocaleSwitcher /> : null}
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
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  )

  return router
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

    await signInUser({
      email: 'user@example.com',
      password: 'Demo-user-2026!'
    })
    const wrongNotes = await listWrongNote()
    expect(wrongNotes.total).toBe(0)
  })

  it('역할을 바꾸면 이전 사용자의 Query cache를 제거한다', async () => {
    const user = userEvent.setup()
    const demoUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(demoUser)
    queryClient.setQueryData(['wrong-note', 'list-wrong-notes'], {
      owner: demoUser.id
    })
    renderLoginPage()

    await user.type(screen.getByLabelText('이메일'), 'admin@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'Demo-admin-2026!')
    await user.keyboard('{Enter}')

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

  it('검수 관리자 자격 증명을 별도 actor에 연결한다', async () => {
    await signInUser({
      email: 'reviewer@example.com',
      password: 'Demo-reviewer-2026!'
    })

    expect(mockDatabase.getCurrentUser()).toMatchObject({
      id: DEMO_REVIEWER_ADMIN_ID,
      role: 'ADMIN'
    })
  })

  it('게스트가 보호 경로로 되돌아가지 않도록 홈으로 안내한다', async () => {
    const user = userEvent.setup()
    renderLoginPage('/dashboard')

    await user.click(screen.getByRole('button', { name: '게스트로 계속' }))

    expect(await screen.findByText('홈 도착')).toBeInTheDocument()
  })

  it('Mock mode에서는 미구현 auth 기능을 성공처럼 노출하지 않는다', () => {
    renderLoginPage()

    expect(
      screen.getByText(/회원가입·이메일 인증·비밀번호 재설정은/u)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '회원가입' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: '비밀번호를 잊으셨나요?' })
    ).toBeDisabled()
  })

  it('게스트가 다른 사용자의 세션 URL 대신 학습 설정으로 이동한다', async () => {
    const user = userEvent.setup()
    renderLoginPage('/practice/session/user-session')

    await user.click(screen.getByRole('button', { name: '게스트로 계속' }))

    expect(await screen.findByText('학습 설정 도착')).toBeInTheDocument()
  })

  it('locale 전환 중 RHF 입력과 redirect query를 보존한다', async () => {
    const user = userEvent.setup()
    const router = renderLoginPage('/practice?level=N2', true)
    const email = screen.getByLabelText('이메일')
    const password = screen.getByLabelText('비밀번호')

    await user.type(email, 'learner@example.com')
    await user.type(password, 'Unsubmitted-password!')
    await user.selectOptions(screen.getByLabelText('언어'), 'ja')

    expect(await screen.findByLabelText('メールアドレス')).toHaveValue(
      'learner@example.com'
    )
    expect(screen.getByLabelText('パスワード')).toHaveValue(
      'Unsubmitted-password!'
    )
    expect(router.state.location).toMatchObject({
      pathname: '/login',
      search: '?redirect=%2Fpractice%3Flevel%3DN2'
    })
    expect(document.documentElement).toHaveAttribute('lang', 'ja')
  })
})

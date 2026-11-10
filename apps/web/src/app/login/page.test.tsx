import { appDocumentNavigation } from '@nihongo/browser/libs/appNavigation'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { getCurrentUser } from '@nihongo/browser/api/auth/getCurrentUser/index'
import { signInSocial } from '@api/auth/signInSocial'
import { completeMockSocialSignIn } from '@api/auth/completeMockSocialSignIn'
import { loginRoutes } from '@app/login/router'
import { SsoProviderButton } from '@app/login/components/SsoProviderButton'
import { ReauthReturnNotice } from '@nihongo/browser/app/reauth/components/ReauthReturnNotice'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import { LocaleSwitcher } from '@nihongo/browser/common/components/LocaleSwitcher'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { emitApiError } from '@nihongo/browser/libs/errorBus'
import { DEMO_ADMIN_ID, DEMO_USER_ID } from '@mocks/data/users'
import {
  grantMockAdminFreshForTesting,
  setMockSsoAccountForTesting
} from '@mocks/handlers/authHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { AuthErrorHandlerProvider } from '@nihongo/browser/provider/AuthErrorHandlerProvider'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { useAppStore } from '@nihongo/browser/store/index'
import { mockServer } from '@/test/server'

const getAnnouncedStatus = (): HTMLElement => {
  const statuses = screen
    .getAllByRole('status')
    .filter((status) => status.textContent?.trim())
  expect(statuses).toHaveLength(1)
  return statuses[0]!
}

const renderLogin = (entry = '/login', gateOutlet = false) => {
  const adminApp = entry.startsWith('/admin/')
  const Shell = () => {
    const content = (
      <>
        <AuthErrorHandlerProvider />
        <LocaleSwitcher />
        <Outlet />
      </>
    )
    return (
      <ProtectedRouteProvider>
        {gateOutlet ? <ReadyOutlet /> : content}
      </ProtectedRouteProvider>
    )
  }
  // Match the actual Layout readiness gate: canonical refresh may remove the
  // login observer while the mutation's owning onSuccess still must navigate.
  const ReadyOutlet = () => {
    const { isReady } = useAuth()
    return isReady ? (
      <>
        <AuthErrorHandlerProvider />
        <Outlet />
      </>
    ) : (
      <p>확인 중</p>
    )
  }
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          ...loginRoutes,
          { path: '/practice', element: <p>학습 설정 도착</p> },
          {
            path: '/practice/session/:sessionId',
            element: <p>학습 풀이 도착</p>
          },
          { path: '/dashboard', element: <p>대시보드 도착</p> },
          {
            path: adminApp ? '/questions' : '/admin/questions',
            element: <p>관리자 작업 화면</p>
          },
          { path: '/', element: <p>홈 도착</p> }
        ]
      }
    ],
    { initialEntries: [entry], basename: adminApp ? '/admin' : '/' }
  )
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <Suspense fallback={<p>불러오는 중</p>}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </Suspense>
      </I18nProvider>
    </QueryClientProvider>
  )
  return router
}
import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'

describe('현재 Google SSO 로그인', () => {
  beforeAll(async () => {
    // Await the lazy route module before the first DOM query starts its timeout.
    await import('@app/login/page')
  })

  it('Google만 노출하고 Apple·이메일·암호·가입 UI는 제공하지 않는다', async () => {
    renderLogin()
    expect(
      await screen.findByRole('button', { name: 'Google로 계속하기' })
    ).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: /Apple/ })
    ).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Apple')
    expect(document.querySelector('[data-provider="apple"]')).toBeNull()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(document.querySelector('input[type=password]')).toBeNull()
    expect(
      screen.queryByRole('button', { name: '회원가입' })
    ).not.toBeInTheDocument()
    const consent = document.querySelector('.auth-consent')
    expect(consent).toHaveTextContent(
      '계속하면 이용약관과 개인정보 처리방침을 확인한 것으로 봅니다. 만 14세 미만은 가입할 수 없습니다.'
    )
    expect(
      within(consent as HTMLElement).getByRole('link', { name: '이용약관' })
    ).toHaveAttribute('href', '/legal#terms')
    expect(
      within(consent as HTMLElement).getByRole('link', {
        name: '개인정보 처리방침'
      })
    ).toHaveAttribute('href', '/legal#privacy')
    expect(
      screen.getByText(
        /하루 3번, 한 번에 10문제씩 풀 수 있어요\. 기록은 남지 않아요\./
      )
    ).toBeInTheDocument()
  })

  it.each(['Google'])(
    '%s 선택 후 새 canonical 회원을 확인하고 안전한 필터로 돌아간다',
    async (provider) => {
      const user = userEvent.setup()
      queryClient.setQueryData(['wrong-note', 'private'], {
        owner: 'previous-account'
      })
      useAppStore
        .getState()
        .beginPractice('stale-private-session', '2026-10-19T00:00:00.000Z')
      const router = renderLogin(
        '/login?redirect=' +
          encodeURIComponent(
            '/practice?level=N2&subject=GRAMMAR&count=10&resumePage=2'
          ),
        true
      )
      await user.click(
        await screen.findByRole('button', { name: provider + '로 계속하기' })
      )
      expect(await screen.findByText('학습 설정 도착')).toBeInTheDocument()
      expect(router.state.location.search).toBe(
        '?level=N2&subject=GRAMMAR&count=10&resumePage=2'
      )
      expect(useAppStore.getState().currentUser).toMatchObject({
        id: DEMO_USER_ID,
        role: 'USER'
      })
      expect(
        queryClient.getQueryData(['wrong-note', 'private'])
      ).toBeUndefined()
      expect(useAppStore.getState().sessionId).toBeNull()
    }
  )

  it.each(['google'] as const)(
    '%s는 중복 만료 오류 뒤에도 하나의 안전한 학습 세션 경로를 callback으로 보존한다',
    async (provider) => {
      const actor = mockDatabase.loginAs('USER')
      const target =
        '/practice/session/018f6b7a-1f4b-7d5e-8a91-000000000900?level=N2&subject=GRAMMAR'
      const starts: unknown[] = []
      const router = renderLogin(target)
      await waitFor(() =>
        expect(useAppStore.getState().currentUser?.id).toBe(actor.id)
      )
      mockServer.use(
        http.get('*/api/v1/me', () => HttpResponse.json({ kind: 'GUEST' })),
        http.post('*/api/auth/sign-in/social', async ({ request }) => {
          starts.push(await request.json())
          return HttpResponse.json(
            {
              code: 'SSO_UNAVAILABLE',
              message: 'Synthetic provider unavailable'
            },
            { status: 503 }
          )
        })
      )
      useAppStore
        .getState()
        .beginPractice('synthetic-private-expired', '2026-10-20T00:00:00.000Z')
      queryClient.setQueryData(['bookmarks', 'expired-private'], {
        owner: 'synthetic-old-user'
      })
      const expire = () =>
        emitApiError(
          Object.assign(new Error('Synthetic expired session'), {
            isAuthError: true,
            status: 401,
            code: 'AUTH_SESSION_EXPIRED'
          })
        )
      act(() => {
        expire()
        expire()
      })
      const google = await screen.findByRole('button', {
        name: 'Google로 계속하기'
      })
      await waitFor(() => expect(router.state.location.state).toBeNull())
      await act(async () => {
        expire()
        expire()
      })
      const search = new URLSearchParams(router.state.location.search)
      expect(router.state.location.pathname).toBe('/login')
      expect(search.getAll('redirect')).toEqual([target])
      expect([...search.keys()]).toEqual(['redirect'])
      expect(router.state.location.state).toBeNull()
      expect(router.state.location.hash).toBe('')
      expect(useAppStore.getState().currentUser).toBeNull()
      expect(useAppStore.getState().sessionId).toBeNull()
      expect(
        queryClient.getQueryData(['bookmarks', 'expired-private'])
      ).toBeUndefined()
      expect(starts).toEqual([])
      expect(google).toBeEnabled()
      const chosen = screen.getByRole('button', {
        name: 'Google로 계속하기'
      })
      await userEvent.setup().click(chosen)
      await screen.findByRole('alert')
      expect(starts).toEqual([{ provider, callbackURL: target }])
      expect(
        new URLSearchParams(router.state.location.search).getAll('redirect')
      ).toEqual([target])
      expect(chosen).toHaveFocus()
    }
  )

  it('중복 Google 시작을 막고 실패 후 버튼과 현재 복귀 경로를 복구한다', async () => {
    let respond: (() => void) | undefined
    let starts = 0
    mockServer.use(
      http.post('*/api/auth/sign-in/social', async () => {
        starts += 1
        await new Promise<void>((resolve) => {
          respond = resolve
        })
        return HttpResponse.json(
          {
            code: 'SSO_UNAVAILABLE',
            message: 'server detail must stay private'
          },
          { status: 503 }
        )
      })
    )
    const user = userEvent.setup()
    const router = renderLogin(
      '/login?redirect=' + encodeURIComponent('/dashboard?view=learning')
    )
    const google = await screen.findByRole('button', {
      name: 'Google로 계속하기'
    })
    await user.dblClick(google)
    await waitFor(() => expect(starts).toBe(1))
    expect(google).toBeDisabled()
    expect(google).toHaveAccessibleName('Google로 이동하는 중…')
    expect(google).toHaveAttribute('aria-busy', 'true')
    expect(google.querySelectorAll('.ui-spinner')).toHaveLength(1)
    expect(google.querySelector('img')).toBeNull()
    expect(getAnnouncedStatus()).toHaveTextContent('Google로 이동하는 중…')
    expect(getAnnouncedStatus()).toHaveClass('sr-only')
    expect(getAnnouncedStatus().closest('[aria-busy]')).toBeNull()
    await act(async () => {
      respond?.()
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '지금은 Google로 로그인할 수 없어요.'
    )
    expect(google).toBeEnabled()
    expect(google).toHaveAccessibleName('Google로 계속하기')
    expect(google).not.toHaveAttribute('aria-busy')
    expect(google.querySelector('.ui-spinner')).toBeNull()
    expect(google.querySelector('img')).not.toBeNull()
    expect(router.state.location.pathname).toBe('/login')
    expect(
      new URLSearchParams(router.state.location.search).get('redirect')
    ).toBe('/dashboard?view=learning')
    expect(document.body).not.toHaveTextContent('server detail')
    expect(starts).toBe(1)
  })

  it.each(['CANCELLED', 'FAILED', 'INVALID_CALLBACK'])(
    '서버 %s 복귀는 상태를 알리고 원문 query·fragment를 제거한다',
    async (outcome) => {
      const router = renderLogin(
        '/login?sso=' +
          outcome +
          '&redirect=' +
          encodeURIComponent('/practice?level=N1') +
          '&code=private-value#id_token=private-value'
      )
      await screen.findByRole('button', { name: 'Google로 계속하기' })
      await waitFor(() =>
        expect(router.state.location.search).toBe(
          '?redirect=%2Fpractice%3Flevel%3DN1'
        )
      )
      expect(router.state.location.hash).toBe('')
      expect(document.body).not.toHaveTextContent('private-value')
      expect(mockDatabase.getCurrentUser()).toBeNull()
      // Errors put focus on the recovering button; a cancel is only news.
      await waitFor(() =>
        expect(
          outcome === 'CANCELLED'
            ? screen.getByRole('heading', { name: '로그인' })
            : screen.getByRole('button', { name: 'Google로 계속하기' })
        ).toHaveFocus()
      )
    }
  )

  it.each(['/reset-password', '/verify-email', '/login?mode=signup'])(
    '구형 링크 %s는 민감 값을 버리고 SSO 안내로 replace한다',
    async (path) => {
      const router = renderLogin(
        path +
          (path.includes('?') ? '&' : '?') +
          'token=legacy-secret&redirect=' +
          encodeURIComponent('/practice?count=5') +
          '#legacy-secret'
      )
      expect(
        await screen.findByText(
          '로그인 방법이 Google로 바뀌었어요. Google 계정으로 계속해 주세요.'
        )
      ).toBeInTheDocument()
      await waitFor(() =>
        expect(
          router.state.location.pathname + router.state.location.search
        ).toBe('/login?redirect=%2Fpractice%3Fcount%3D5')
      )
      expect(router.state.location.hash).toBe('')
      expect(router.state.historyAction).toBe('REPLACE')
    }
  )

  it('자기 인증·외부 복귀 주소는 홈으로 정규화하고 게스트는 공개 학습으로 간다', async () => {
    const user = userEvent.setup()
    const router = renderLogin(
      '/login?redirect=' +
        encodeURIComponent('/login?redirect=https://outside.example')
    )
    await user.click(
      await screen.findByRole('link', { name: '로그인 없이 풀어 보기' })
    )
    expect(await screen.findByText('학습 설정 도착')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/practice')
    expect(mockDatabase.getCurrentUser()).toBeNull()
  })

  it.each(['USER', 'ADMIN'] as const)(
    '로그인한 %s는 /login 대신 학습 홈으로 replace 이동한다',
    async (role) => {
      mockDatabase.loginAs(role)
      const router = renderLogin()
      expect(await screen.findByText('홈 도착')).toBeInTheDocument()
      expect(router.state.historyAction).toBe('REPLACE')
      expect(
        screen.queryByRole('region', { name: '본인 확인' })
      ).not.toBeInTheDocument()
    }
  )

  it('공급자 이름이 권한을 정하지 않으며 fixture의 기존 내부 계정을 소비한다', async () => {
    setMockSsoAccountForTesting('google', DEMO_ADMIN_ID)
    const user = userEvent.setup()
    renderLogin('/login?redirect=%2Fdashboard')
    await user.click(
      await screen.findByRole('button', { name: 'Google로 계속하기' })
    )
    expect(await screen.findByText('대시보드 도착')).toBeInTheDocument()
    expect(useAppStore.getState().currentUser).toMatchObject({
      id: DEMO_ADMIN_ID,
      role: 'ADMIN'
    })
  })

  it('외부 비활성은 진행 표시 없이 브랜드를 유지하고 실제 진행만 한 번 알린다', () => {
    const view = (isLoading: boolean) => (
      <I18nProvider>
        <SsoProviderButton
          provider="google"
          label="Google로 계속하기"
          disabled
          isLoading={isLoading}
          loadingLabel="Google로 이동하는 중…"
          onClick={() => undefined}
        />
      </I18nProvider>
    )
    const { rerender } = render(view(false))
    const button = screen.getByRole('button', { name: 'Google로 계속하기' })
    expect(button).toBeDisabled()
    expect(button).not.toHaveAttribute('aria-busy')
    expect(button.querySelector('.ui-spinner')).toBeNull()
    expect(button.querySelector('img')).not.toBeNull()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    rerender(view(true))
    expect(button).toHaveAccessibleName('Google로 이동하는 중…')
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelectorAll('.ui-spinner')).toHaveLength(1)
    expect(getAnnouncedStatus()).toHaveClass('sr-only')
    rerender(view(false))
    expect(button).toHaveAccessibleName('Google로 계속하기')
    expect(button.querySelector('.ui-spinner')).toBeNull()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('시작 요청만으로 로그인되지 않고 일치한 callback만 한 번 소비한다', async () => {
    await signInSocial({ provider: 'apple' })
    expect(await getCurrentUser()).toBeNull()
    await expect(completeMockSocialSignIn('google')).rejects.toBeDefined()
    expect(await getCurrentUser()).toBeNull()
    await completeMockSocialSignIn('apple')
    expect(await getCurrentUser()).toMatchObject({ id: DEMO_USER_ID })
    await expect(completeMockSocialSignIn('apple')).rejects.toBeDefined()
  })

  it('KO·JA 전환에도 Google만 노출하고 Apple 안내를 숨긴다', async () => {
    renderLogin()
    await screen.findByRole('button', { name: 'Google로 계속하기' })
    const user = userEvent.setup()
    await user.selectOptions(
      screen.getByRole('combobox', { name: '언어' }),
      'ja'
    )
    expect(
      await screen.findByRole('button', { name: 'Googleで続ける' })
    ).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: /Apple/ })
    ).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Apple')
  })
})

describe('관리자 ADMIN_FRESH 소비', () => {
  it('로그인한 관리자의 예전 /login?redirect=/admin 링크는 중간 화면 없이 관리자 화면으로 간다', async () => {
    const replaceDocument = vi
      .spyOn(appDocumentNavigation, 'replace')
      .mockImplementation(() => undefined)
    mockDatabase.loginAs('ADMIN')
    const router = renderLogin(
      '/login?redirect=' +
        encodeURIComponent('/admin/questions?level=N5&page=2')
    )
    await waitFor(() =>
      expect(replaceDocument).toHaveBeenCalledExactlyOnceWith(
        '/admin/questions?level=N5&page=2'
      )
    )
    expect(router.state.location.pathname).toBe('/login')
    expect(
      screen.queryByRole('button', { name: 'Google로 확인하기' })
    ).not.toBeInTheDocument()
  })

  it.each([
    ['REAUTHENTICATED', '본인 확인을 마쳤습니다(30분 유효).'],
    ['CANCELLED', '본인 확인을 취소했습니다.'],
    ['FAILED', '본인 확인을 마치지 못했습니다.'],
    ['INVALID_CALLBACK', '확인 요청이 만료되었습니다.']
  ])(
    '%s 복귀는 canonical 신원 조회 후 유한 안내만 표시한다',
    async (outcome, copy) => {
      const actor = mockDatabase.loginAs('ADMIN')
      grantMockAdminFreshForTesting(actor.id)
      const router = renderLogin(
        '/admin/questions?level=N2&page=2&ssoFresh=' + outcome
      )
      await waitFor(() => expect(getAnnouncedStatus()).toHaveTextContent(copy))
      expect(
        router.state.location.pathname + router.state.location.search
      ).toBe('/admin/questions?level=N2&page=2')
      expect(router.state.historyAction).toBe('REPLACE')
      // The notice text commits before its passive focus effect.
      await waitFor(() => expect(getAnnouncedStatus()).toHaveFocus())
      expect(mockDatabase.getCurrentUser()?.role).toBe('ADMIN')
    }
  )

  it('중복·알 수 없는 성공 힌트와 원문 인증 값은 안전한 실패 안내로 정리한다', async () => {
    mockDatabase.loginAs('ADMIN')
    const router = renderLogin(
      '/login?ssoFresh=REAUTHENTICATED&ssoFresh=forged&code=private-code#private-fragment'
    )
    await waitFor(() =>
      expect(getAnnouncedStatus()).toHaveTextContent(
        '확인 요청이 만료되었습니다.'
      )
    )
    expect(router.state.location.search).toBe('')
    expect(router.state.location.hash).toBe('')
    expect(document.body).not.toHaveTextContent('private-code')
  })

  it('응답 유실 후 서버가 GUEST이면 이전 ADMIN 캐시·세션을 복원하지 않는다', async () => {
    const actor = mockDatabase.loginAs('ADMIN')
    useAppStore.getState().setCurrentUser(actor)
    queryClient.setQueryData(['auth', 'get-current-user'], actor)
    queryClient.setQueryData(['bookmarks', 'private'], { owner: actor.id })
    mockDatabase.logout()
    renderLogin('/login?ssoFresh=FAILED')
    await screen.findByRole('button', { name: 'Google로 계속하기' })
    await waitFor(() => expect(useAppStore.getState().currentUser).toBeNull())
    expect(queryClient.getQueryData(['bookmarks', 'private'])).toBeUndefined()
    expect(
      screen.queryByRole('region', { name: '본인 확인' })
    ).not.toBeInTheDocument()
    expect(getAnnouncedStatus()).toHaveTextContent(
      '본인 확인을 마치지 못했습니다.'
    )
  })

  it('복귀 조회 도중 다른 인증 전환이 시작되면 성공이나 무한 대기를 표시하지 않는다', async () => {
    const actor = mockDatabase.loginAs('ADMIN')
    useAppStore.getState().setCurrentUser(actor)
    let finish: (() => void) | undefined
    mockServer.use(
      http.get('*/api/v1/me', async () => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return HttpResponse.json({
          kind: 'USER',
          user: {
            id: actor.id,
            name: actor.name,
            role: actor.role,
            targetLevel: actor.targetLevel
          }
        })
      })
    )
    const router = createMemoryRouter(
      [{ path: '/login', element: <ReauthReturnNotice /> }],
      { initialEntries: ['/login?ssoFresh=REAUTHENTICATED'] }
    )
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>
    )
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    invalidateCanonicalAuthTransitions()
    await act(async () => finish?.())
    await waitFor(() =>
      expect(getAnnouncedStatus()).toHaveTextContent(
        '연결 문제로 결과를 확인하지 못했습니다.'
      )
    )
    expect(getAnnouncedStatus()).toHaveFocus()
    expect(getAnnouncedStatus()).not.toHaveTextContent('본인 확인을 마쳤습니다')
    expect(useAppStore.getState().currentUser?.id).toBe(actor.id)
  })

  it('일반 USER에게 재인증 진입을 제공하지 않는다', async () => {
    mockDatabase.loginAs('USER')
    renderLogin('/login?redirect=%2Fadmin%2Fquestions')
    await screen.findByText('홈 도착')
    expect(
      screen.queryByRole('region', { name: '본인 확인' })
    ).not.toBeInTheDocument()
  })
})

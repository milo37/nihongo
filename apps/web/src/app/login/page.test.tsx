import { Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { getCurrentUser } from '@api/auth/getCurrentUser'
import { signInSocial } from '@api/auth/signInSocial'
import { completeMockSocialSignIn } from '@api/auth/completeMockSocialSignIn'
import { loginRoutes } from '@app/login/router'
import { AdminFreshReturnNotice } from '@app/login/components/AdminFreshReturnNotice'
import { invalidateCanonicalAuthTransitions } from '@app/login/authSession'
import { LocaleSwitcher } from '@common/components/LocaleSwitcher'
import { queryClient } from '@libs/queryClient'
import { emitApiError } from '@libs/errorBus'
import { DEMO_ADMIN_ID, DEMO_USER_ID } from '@mocks/data/users'
import { setMockSsoAccountForTesting } from '@mocks/handlers/authHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { AuthErrorHandlerProvider } from '@provider/AuthErrorHandlerProvider'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { I18nProvider } from '@provider/I18nProvider'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const renderLogin = (entry = '/login', gateOutlet = false) => {
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
          { path: '/admin/questions', element: <p>관리자 작업 화면</p> },
          { path: '/', element: <p>홈 도착</p> }
        ]
      }
    ],
    { initialEntries: [entry] }
  )
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <Suspense fallback={<p>불러오는 중</p>}>
          <RouterProvider router={router} />
        </Suspense>
      </I18nProvider>
    </QueryClientProvider>
  )
  return router
}
import { useAuth } from '@provider/ProtectedRouteProvider'

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
    expect(
      screen.getByRole('button', { name: 'Google로 계속하기' })
    ).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Google로 이동하고 있어요.'
    )
    await act(async () => {
      respond?.()
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '지금은 Google 로그인을 이용할 수 없어요.'
    )
    expect(google).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Google로 계속하기' })
    ).toBeEnabled()
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
      expect(screen.getByRole('heading', { name: '로그인' })).toHaveFocus()
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
          '로그인 방법이 변경되었어요. 연결한 계정으로 계속해 주세요.'
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
      await screen.findByRole('link', { name: '로그인 없이 학습하기' })
    )
    expect(await screen.findByText('홈 도착')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(mockDatabase.getCurrentUser()).toBeNull()
  })

  it('로그아웃 취소는 유지하고 확인 후 fresh /me의 GUEST와 cache 정리를 확인한다', async () => {
    const existing = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(existing)
    const user = userEvent.setup()
    const router = renderLogin('/login?redirect=%2Fdashboard', true)
    const button = await screen.findByRole('button', { name: '로그아웃' })
    queryClient.setQueryData(['bookmarks', 'private'], { owner: existing.id })
    await user.click(button)
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(mockDatabase.getCurrentUser()?.id).toBe(existing.id)
    expect(button).toHaveFocus()
    await user.click(button)
    dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByText('학습 설정 도착')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/practice')
    expect(await screen.findByRole('status')).toHaveTextContent(
      '로그아웃했어요.'
    )
    expect(useAppStore.getState().currentUser).toBeNull()
    expect(queryClient.getQueryData(['auth', 'get-current-user'])).toBeNull()
    expect(queryClient.getQueryData(['bookmarks', 'private'])).toBeUndefined()
  })

  it('불명확한 로그아웃은 명령을 반복하지 않고 canonical 상태부터 다시 확인한다', async () => {
    mockDatabase.loginAs('USER')
    let signouts = 0
    mockServer.use(
      http.post('*/api/auth/sign-out', () => {
        signouts += 1
        return HttpResponse.json(
          { code: 'SERVER_ERROR', message: 'private error' },
          { status: 500 }
        )
      })
    )
    renderLogin()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '로그아웃' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '로그아웃' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '로그아웃 상태를 확인하지 못했어요.'
    )
    expect(signouts).toBe(1)
    await user.click(within(dialog).getByRole('button', { name: '다시 확인' }))
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: '로그아웃' })
      ).toBeEnabled()
    )
    expect(mockDatabase.getCurrentUser()?.id).toBe(DEMO_USER_ID)
    expect(signouts).toBe(1)
  })

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

const validFreshURL = (provider: 'apple' | 'google'): string => {
  const url = new URL(
    provider === 'apple'
      ? 'https://appleid.apple.com/auth/authorize'
      : 'https://accounts.google.com/o/oauth2/v2/auth'
  )
  url.search = new URLSearchParams({
    state: 's'.repeat(43),
    nonce: 'n'.repeat(43),
    code_challenge: 'c'.repeat(43),
    code_challenge_method: 'S256',
    response_type: 'code',
    ...(provider === 'apple' ? { response_mode: 'form_post' } : {})
  }).toString()
  return url.href
}

describe('관리자 ADMIN_FRESH 소비', () => {
  it.each(['google'] as const)(
    '%s에서 목적·업무 경로를 보내고 돌아와도 명령·fresh 권한을 만들지 않는다',
    async (provider) => {
      const actor = mockDatabase.loginAs('ADMIN')
      const requests: unknown[] = []
      mockServer.use(
        http.post('*/api/auth/sign-in/social', async ({ request }) => {
          requests.push(await request.json())
          return HttpResponse.json({
            url: validFreshURL(provider),
            redirect: true
          })
        })
      )
      const router = renderLogin(
        '/login?redirect=' +
          encodeURIComponent('/admin/questions?level=N5&page=2')
      )
      const region = await screen.findByRole('region', {
        name: '관리자 본인 확인'
      })
      queryClient.setQueryData(['bookmarks', 'private'], { owner: actor.id })
      useAppStore
        .getState()
        .beginPractice('preserved-admin-draft', '2026-10-19T00:00:00.000Z')
      const user = userEvent.setup()
      await user.click(
        within(region).getByRole('button', {
          name: 'Google로 계속하기'
        })
      )
      expect(await screen.findByText('관리자 작업 화면')).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          '작업 권한은 서버에서 다시 확인합니다.'
        )
      )
      expect(requests).toEqual([
        {
          purpose: 'ADMIN_FRESH',
          provider,
          callbackURL: '/admin/questions?level=N5&page=2'
        }
      ])
      expect(router.state.location.search).toBe('?level=N5&page=2')
      expect(useAppStore.getState().currentUser).toMatchObject({
        id: actor.id,
        role: 'ADMIN'
      })
      expect(useAppStore.getState().sessionId).toBe('preserved-admin-draft')
      expect(queryClient.getQueryData(['bookmarks', 'private'])).toEqual({
        owner: actor.id
      })
      expect(document.body).not.toHaveTextContent('본인 확인이 완료')
      expect(document.body).not.toHaveTextContent('5분')
    }
  )

  it.each([
    ['REAUTHENTICATED', '작업 권한은 서버에서 다시 확인합니다.'],
    ['CANCELLED', '본인 확인을 취소했어요.'],
    ['FAILED', '본인 확인 결과를 확인하지 못했어요.'],
    ['INVALID_CALLBACK', '본인 확인 요청이 만료되었거나 올바르지 않아요.']
  ])(
    '%s 복귀는 canonical 신원 조회 후 유한 안내만 표시한다',
    async (outcome, copy) => {
      mockDatabase.loginAs('ADMIN')
      const router = renderLogin(
        '/admin/questions?level=N2&page=2&ssoFresh=' + outcome
      )
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(copy)
      )
      expect(
        router.state.location.pathname + router.state.location.search
      ).toBe('/admin/questions?level=N2&page=2')
      expect(router.state.historyAction).toBe('REPLACE')
      // The notice text commits before its passive focus effect.
      await waitFor(() => expect(screen.getByRole('status')).toHaveFocus())
      expect(mockDatabase.getCurrentUser()?.role).toBe('ADMIN')
    }
  )

  it('중복·알 수 없는 성공 힌트와 원문 인증 값은 안전한 실패 안내로 정리한다', async () => {
    mockDatabase.loginAs('ADMIN')
    const router = renderLogin(
      '/login?ssoFresh=REAUTHENTICATED&ssoFresh=forged&code=private-code#private-fragment'
    )
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '본인 확인 요청이 만료되었거나 올바르지 않아요.'
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
      screen.queryByRole('region', { name: '관리자 본인 확인' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      '본인 확인 결과를 확인하지 못했어요.'
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
      [{ path: '/login', element: <AdminFreshReturnNotice /> }],
      { initialEntries: ['/login?ssoFresh=REAUTHENTICATED'] }
    )
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <RouterProvider router={router} />
        </I18nProvider>
      </QueryClientProvider>
    )
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    invalidateCanonicalAuthTransitions()
    await act(async () => finish?.())
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '현재 로그인 상태를 확인하지 못했어요.'
      )
    )
    expect(screen.getByRole('status')).toHaveFocus()
    expect(screen.getByRole('status')).not.toHaveTextContent(
      '작업 권한은 서버에서 다시 확인합니다.'
    )
    expect(useAppStore.getState().currentUser?.id).toBe(actor.id)
  })

  it('일반 USER에게 재인증 진입을 제공하지 않는다', async () => {
    mockDatabase.loginAs('USER')
    renderLogin()
    await screen.findByRole('button', { name: '로그아웃' })
    expect(
      screen.queryByRole('region', { name: '관리자 본인 확인' })
    ).not.toBeInTheDocument()
  })

  it('Google 시작503은 버튼을 잠근 뒤 복구하고 이전 ADMIN·초안을 유지한다', async () => {
    const actor = mockDatabase.loginAs('ADMIN')
    let finish: (() => void) | undefined
    let starts = 0
    mockServer.use(
      http.post('*/api/auth/sign-in/social', async () => {
        starts += 1
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return HttpResponse.json(
          { code: 'SSO_UNAVAILABLE', message: 'private-detail' },
          { status: 503 }
        )
      })
    )
    renderLogin()
    const region = await screen.findByRole('region', {
      name: '관리자 본인 확인'
    })
    useAppStore
      .getState()
      .beginPractice('preserved-fresh-error', '2026-10-19T00:00:00.000Z')
    const user = userEvent.setup()
    const google = within(region).getByRole('button', {
      name: 'Google로 계속하기'
    })
    expect(
      within(region).queryByRole('button', { name: /Apple/ })
    ).not.toBeInTheDocument()
    await user.dblClick(google)
    await waitFor(() => expect(starts).toBe(1))
    expect(google).toBeDisabled()
    await act(async () => finish?.())
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      '지금은 로그인을 이용할 수 없어요.'
    )
    expect(google).toBeEnabled()
    expect(google).toHaveFocus()
    expect(useAppStore.getState().currentUser?.id).toBe(actor.id)
    expect(useAppStore.getState().sessionId).toBe('preserved-fresh-error')
    expect(document.body).not.toHaveTextContent('private-detail')
    expect(starts).toBe(1)
  })
})

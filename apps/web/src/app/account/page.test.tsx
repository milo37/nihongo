import { accountMutationRequest } from '@app/account/accountFlowErrors'
import { commitCanonicalAuth } from '@nihongo/browser/app/login/authSession'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { getResponse, http, HttpResponse } from 'msw'
import { apiClient } from '@nihongo/browser/api/config'
import { startAccountSso } from '@api/auth/startAccountSso'
import { accountRoutes } from '@app/account/router'
import { loginRoutes } from '@app/login/router'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { DEMO_USER_ID } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { AuthErrorHandlerProvider } from '@nihongo/browser/provider/AuthErrorHandlerProvider'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { useAppStore } from '@nihongo/browser/store/index'
import { handlers } from '@mocks/handlers'
import { mockServer } from '@/test/server'

const renderAccount = (entry = '/account') => {
  const router = createMemoryRouter(
    [
      {
        element: (
          <ProtectedRouteProvider>
            <AuthErrorHandlerProvider />
            <Outlet />
          </ProtectedRouteProvider>
        ),
        children: [
          ...accountRoutes,
          ...loginRoutes,
          { path: '/', element: <p>학습 홈</p> }
        ]
      }
    ],
    { initialEntries: [entry] }
  )
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <Suspense fallback={<p>확인 중</p>}>
            <RouterProvider router={router} />
          </Suspense>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
  return router
}
const linkedActor = () => {
  const actor = mockDatabase.loginAs('USER')
  mockDatabase.ssoAccounts.prepare({
    purpose: 'ACCOUNT_FRESH',
    provider: 'google'
  })
  mockDatabase.ssoAccounts.complete(
    { purpose: 'ACCOUNT_FRESH', provider: 'google' },
    actor.id
  )
  mockDatabase.ssoAccounts.prepare({
    purpose: 'ACCOUNT_LINK',
    provider: 'apple'
  })
  mockDatabase.ssoAccounts.complete(
    { purpose: 'ACCOUNT_LINK', provider: 'apple' },
    actor.id
  )
  return actor
}
const freshActor = () => {
  const actor = mockDatabase.loginAs('USER')
  mockDatabase.ssoAccounts.prepare({
    purpose: 'ACCOUNT_FRESH',
    provider: 'google'
  })
  mockDatabase.ssoAccounts.complete(
    { purpose: 'ACCOUNT_FRESH', provider: 'google' },
    actor.id
  )
  return actor
}
const countPosts = (
  posts: { mock: { calls: readonly (readonly unknown[])[] } },
  path: string
) => posts.mock.calls.filter((call) => call[0] === path).length
const deletionReads = () => {
  let reads = 0
  mockServer.use(
    http.get('*/api/auth/sso/deletion', () => {
      reads += 1
      return HttpResponse.json(
        { code: 'SSO_DELETION_RECEIPT_UNAVAILABLE', message: '없음' },
        { status: 404 }
      )
    })
  )
  return () => reads
}
const openDeleteDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: '회원 탈퇴' }))
  return screen.getByRole('dialog', { name: '회원 탈퇴할까요?' })
}
describe('마이페이지 계정 설정', () => {
  beforeAll(async () => {
    // Await the lazy route modules before the first DOM query starts its timeout.
    await import('@app/account/page')
    await import('@app/account/data-page')
    await import('@app/login/page')
  })
  afterEach(() => sessionStorage.clear())

  it('비로그인은 오류 없이 로그인 카드만 보여 주고 계정 API를 읽지 않는다', async () => {
    const reads = deletionReads()
    const get = vi.spyOn(apiClient, 'get')
    renderAccount()
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: '푼 기록이 여기에 남아요'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '로그인하면 과목별 정답률과 목표 급수를 볼 수 있어요. 풀기는 로그인 없이도 돼요.'
      )
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: '그냥 풀러 가기' })
    ).toHaveAttribute('href', '/')
    expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      get.mock.calls.filter((call) => String(call[0]).startsWith('/auth/sso'))
    ).toHaveLength(0)
    expect(reads()).toBe(0)
  })
  it('로그인 회원이 새로고침하면 /me 응답 전에는 확인 중만 보이고 로그인 카드를 보이지 않는다', async () => {
    mockDatabase.loginAs('USER')
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockServer.use(
      http.get('*/api/v1/me', async () => {
        await gate
        return undefined
      })
    )
    renderAccount()
    expect(await screen.findByRole('status')).toHaveTextContent(
      '로그인 확인 중…'
    )
    expect(screen.queryByText('로그인이 필요해요')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Google로 계속하기/u })
    ).not.toBeInTheDocument()
    release()
    expect(await screen.findByText('로그인 중')).toBeInTheDocument()
  })

  it('목표 급수를 고르면 PUT 한 번 뒤 /me를 다시 읽어 새 급수를 쓴다', async () => {
    mockDatabase.loginAs('USER')
    const requests: string[] = []
    const record = ({ request }: { request: Request }) => {
      const { pathname } = new URL(request.url)
      if (pathname.endsWith('/v1/me') || pathname.endsWith('/me/target-level'))
        requests.push(`${request.method} ${pathname}`)
    }
    mockServer.events.on('request:start', record)
    try {
      renderAccount()
      const select = await screen.findByRole('combobox', {
        name: '목표 급수'
      })
      expect(select).toHaveValue('N2')
      requests.length = 0
      await userEvent.selectOptions(select, 'N3')
      await waitFor(() =>
        expect(useAppStore.getState().currentUser?.targetLevel).toBe('N3')
      )
      // The canonical refresh drops the cached /me, so the mounted auth
      // observer may read it once more; every read comes after the PUT.
      expect(requests[0]).toBe('PUT /api/v1/me/target-level')
      expect(requests.slice(1)).toContain('GET /api/v1/me')
      expect(
        requests.slice(1).every((entry) => entry === 'GET /api/v1/me')
      ).toBe(true)
      expect(select).toHaveValue('N3')
      expect(select).toBeEnabled()
      // JLP-848: the saved line is visible, with a check, until the next change.
      const saved = screen.getByRole('status', { name: '' })
      expect(saved).toHaveTextContent(
        '목표 급수를 바꿨어요. 이제 홈과 연습이 N3 문제로 시작해요.'
      )
      expect(saved).not.toHaveClass('sr-only')
      expect(saved.querySelector('svg')).not.toBeNull()
      expect(
        screen.getByText("홈의 '오늘의 한 문제'와 연습을 이 급수로 시작해요.")
      ).toBeVisible()
    } finally {
      mockServer.events.removeListener('request:start', record)
    }
  })

  it('목표 급수 저장 뒤 /me를 다시 읽는 사이 로그아웃되면 이전 사용자를 되살리지 않는다', async () => {
    mockDatabase.loginAs('USER')
    let armed = false
    let loggedOut = false
    mockServer.use(
      http.put('*/api/v1/me/target-level', () => {
        armed = true
      }),
      http.get('*/api/v1/me', async ({ request }) => {
        if (!armed) return
        armed = false
        // This read answers with the old user, but a logout is confirmed
        // while it is in flight.
        const stale = await getResponse(handlers, request)
        mockDatabase.logout()
        await commitCanonicalAuth(queryClient, null, {
          forceClear: true,
          forcePracticeReset: true
        })
        loggedOut = true
        return stale
      })
    )
    renderAccount()
    const select = await screen.findByRole('combobox', { name: '목표 급수' })
    await userEvent.selectOptions(select, 'N3')
    await waitFor(() => expect(loggedOut).toBe(true))
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    expect(useAppStore.getState().currentUser).toBeNull()
    expect(
      queryClient.getQueryData(authQueries.currentUser().queryKey)
    ).toBeNull()
  })

  it('목표 급수 저장이 실패하면 값을 그대로 두고 오류를 알린다', async () => {
    mockDatabase.loginAs('USER')
    mockServer.use(
      http.put('*/api/v1/me/target-level', () =>
        HttpResponse.json(
          { code: 'SERVICE_UNAVAILABLE', message: 'down' },
          { status: 503 }
        )
      )
    )
    renderAccount()
    const select = await screen.findByRole('combobox', {
      name: '목표 급수'
    })
    await userEvent.selectOptions(select, 'N1')
    expect(
      await screen.findByText('저장하지 못했어요. 잠시 뒤 다시 골라 주세요.')
    ).toBeInTheDocument()
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(useAppStore.getState().currentUser?.targetLevel).toBe('N2')
  })

  it('Google 로그인 상태를 보여 주고 해제 버튼과 안내는 두지 않는다 (C2)', async () => {
    mockDatabase.loginAs('USER')
    renderAccount()
    expect(await screen.findByText('로그인 중')).toBeInTheDocument()
    // Unlinking is hidden (C2), and so is the note about it.
    expect(
      screen.queryByText('유일한 로그인 방법이라 연결을 해제할 수 없어요.')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '연결 해제' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeEnabled()
    expect(
      screen.queryByRole('link', { name: '내 데이터는 어떻게 처리되나요?' })
    ).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Apple')
  })
  it('서버가 Apple을 남겨 해제를 허용해도 마지막 노출 수단 Google은 보호한다', async () => {
    const actor = linkedActor()
    const caps = mockDatabase.ssoAccounts.capabilities()
    expect(caps.providers.find((p) => p.provider === 'google')?.canUnlink).toBe(
      true
    )
    const posts = vi.spyOn(apiClient, 'post')
    renderAccount()
    await screen.findByText('로그인 중')
    expect(
      screen.queryByRole('button', { name: '연결 해제' })
    ).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Apple')
    expect(posts).not.toHaveBeenCalled()
    expect(mockDatabase.getCurrentUser()?.id).toBe(actor.id)
  })
  it('공급자 불가·관리 작업 제한에는 이유와 GET 재조회만 제공한다', async () => {
    mockDatabase.loginAs('ADMIN')
    const caps = mockDatabase.ssoAccounts.capabilities()
    mockServer.use(
      http.get('*/api/auth/sso/accounts', () =>
        HttpResponse.json({
          ...caps,
          providers: [
            {
              provider: 'google',
              reauthAvailable: false,
              canUnlink: false,
              unlinkBlockedReason: 'PROVIDER_UNAVAILABLE'
            }
          ],
          linkableProviders: [],
          canDelete: false,
          deletionBlockedReason: 'OPEN_ADMIN_WORK'
        })
      )
    )
    const posts = vi.spyOn(apiClient, 'post')
    renderAccount()
    const deletion = await screen.findByRole('button', { name: '회원 탈퇴' })
    await waitFor(() => expect(deletion).toBeDisabled())
    expect(deletion).toHaveAccessibleDescription(
      '관리 작업이 남아 있어서 지금은 탈퇴할 수 없어요.'
    )
    expect(
      screen.getByText(
        '지금은 Google로 로그인할 수 없어요. 잠시 뒤에 다시 시도해 주세요.'
      )
    ).toBeInTheDocument()
    expect(posts).not.toHaveBeenCalled()
  })
  it('실제 연결이 없는 회원은 전환 미완료를 알리고 fallback을 만들지 않는다', async () => {
    mockDatabase.loginAs('USER')
    const caps = mockDatabase.ssoAccounts.capabilities()
    mockServer.use(
      http.get('*/api/auth/sso/accounts', () =>
        HttpResponse.json({ ...caps, providers: [], linkableProviders: [] })
      )
    )
    renderAccount()
    await screen.findByText(
      '로그인 방법을 불러오지 못했어요. 학습 기록은 그대로 있어요.'
    )
    expect(screen.queryByLabelText(/비밀번호|이메일/)).not.toBeInTheDocument()
  })
  it('일본어에도 같은 로그인 상태를 보여 주고 해제 안내는 두지 않는다', async () => {
    writeUiLocalePreference('ja')
    mockDatabase.loginAs('USER')
    renderAccount()
    expect(await screen.findByText('ログイン中')).toBeInTheDocument()
    expect(
      screen.queryByText('唯一のログイン方法のため、連携を解除できません。')
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '退会する' })).toBeEnabled()
    )
    expect(document.body).not.toHaveTextContent('Apple')
  })
  it('늦게 완료한 계정 mutation은 더 최신 canonical 회원을 덮어쓰지 않는다', async () => {
    const actor = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(actor)
    let finish: ((value: boolean) => void) | undefined
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve
    })
    const operation = accountMutationRequest(() => pending)
    const admin = mockDatabase.loginAs('ADMIN')
    await commitCanonicalAuth(queryClient, admin)
    finish?.(true)
    await expect(operation).rejects.toMatchObject({
      name: 'AuthTransitionSupersededError'
    })
    expect(useAppStore.getState().currentUser?.id).toBe(admin.id)
  })

  it('이전 계정의 지연401도 새 회원 상태를 덮어쓰지 않는다', async () => {
    const actor = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(actor)
    let rejectPending: ((reason: Error) => void) | undefined
    const pending = new Promise<boolean>((_resolve, reject) => {
      rejectPending = reject
    })
    const operation = accountMutationRequest(() => pending)
    const admin = mockDatabase.loginAs('ADMIN')
    await commitCanonicalAuth(queryClient, admin)
    rejectPending?.(
      Object.assign(new Error('Synthetic stale unauthorized'), {
        isAuthError: true,
        status: 401,
        code: 'AUTHENTICATION_REQUIRED'
      })
    )
    await expect(operation).rejects.toMatchObject({
      name: 'AuthTransitionSupersededError'
    })
    expect(useAppStore.getState().currentUser?.id).toBe(admin.id)
  })
  it.each([1440, 390, 320])(
    '%ipx에서 탈퇴는 ① 본인 확인부터 열고 취소하면 포커스를 돌려준다',
    async (width) => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: width
      })
      mockDatabase.loginAs('USER')
      const user = userEvent.setup()
      const posts = vi.spyOn(apiClient, 'post')
      renderAccount()
      const dialog = await openDeleteDialog(user)
      expect(
        within(dialog).getByRole('listitem', { current: 'step' })
      ).toHaveTextContent('본인 확인')
      // Step ② is listed from the start so the length of the flow is clear.
      const steps = within(dialog).getAllByRole('listitem')
      expect(steps).toHaveLength(2)
      expect(steps[1]).toHaveTextContent('마지막 확인')
      expect(steps[1]).not.toHaveAttribute('aria-current')
      expect(
        within(dialog).getByText('확인이 끝나면 이 화면으로 돌아와요.')
      ).toBeInTheDocument()
      expect(
        within(dialog).getByText('회원 탈퇴 전에는 꼭 본인 확인을 해요.')
      ).toBeInTheDocument()
      expect(
        within(dialog).getByRole('button', { name: 'Google로 확인하기' })
      ).toBeEnabled()
      expect(
        within(dialog).queryByRole('button', { name: '회원 탈퇴' })
      ).not.toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus()
      fireEvent(dialog, new Event('cancel', { cancelable: true }))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '회원 탈퇴' })).toHaveFocus()
      )
      expect(posts).not.toHaveBeenCalled()
    }
  )
  it('본인 확인 진행은 버튼 한 곳에만 표시하고 실패 후 복구한다', async () => {
    mockDatabase.loginAs('USER')
    let finish: (() => void) | undefined
    let requests = 0
    mockServer.use(
      http.post('*/api/auth/sign-in/social', async () => {
        requests += 1
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return HttpResponse.json({ code: 'SSO_UNAVAILABLE' }, { status: 503 })
      })
    )
    const user = userEvent.setup()
    renderAccount()
    const dialog = await openDeleteDialog(user)
    const verify = within(dialog).getByRole('button', {
      name: 'Google로 확인하기'
    })
    await user.dblClick(verify)
    await waitFor(() => expect(requests).toBe(1))
    expect(verify).toHaveAttribute('aria-disabled', 'true')
    expect(verify).toHaveAccessibleName('Google로 이동하는 중…')
    expect(verify.querySelectorAll('.ui-spinner')).toHaveLength(1)
    await act(async () => finish?.())
    await waitFor(() => expect(verify).toBeEnabled())
    expect(verify).toHaveAccessibleName('Google로 확인하기')
    expect(within(dialog).getByRole('alert')).toBeInTheDocument()
    expect(requests).toBe(1)
  })
  it('Google 본인 확인 뒤 같은 창이 ② 최종 확인으로 바뀌고 탈퇴는 아직 하지 않는다', async () => {
    const actor = mockDatabase.loginAs('USER')
    const user = userEvent.setup()
    const posts = vi.spyOn(apiClient, 'post')
    const router = renderAccount()
    const opened = await openDeleteDialog(user)
    queryClient.setQueryData(['bookmarks', 'private'], { owner: actor.id })
    await user.click(
      within(opened).getByRole('button', { name: 'Google로 확인하기' })
    )
    // The same-tab return reopens the same dialog at step ②.
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('dialog', { name: '회원 탈퇴할까요?' })
        ).getByRole('listitem', { current: 'step' })
      ).toHaveTextContent('마지막 확인')
    )
    const dialog = screen.getByRole('dialog', { name: '회원 탈퇴할까요?' })
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      '본인 확인을 마쳤어요. 마지막으로 한 번 더 확인해 주세요.'
    )
    expect(within(dialog).getAllByRole('listitem')[0]).toHaveTextContent(
      '본인 확인 완료'
    )
    expect(
      within(dialog).getByRole('heading', { name: '회원 탈퇴할까요?' })
    ).toHaveFocus()
    await waitFor(() =>
      expect(
        router.state.location.pathname + router.state.location.search
      ).toBe('/account')
    )
    expect(dialog).toHaveTextContent(
      '보내 주신 문제 신고는 설명을 지우고 계정과 연결을 끊은 채 남아요.'
    )
    expect(
      within(dialog).getByRole('button', { name: '회원 탈퇴' })
    ).toBeEnabled()
    expect(mockDatabase.ssoAccounts.capabilities().freshVerified).toBe(true)
    expect(countPosts(posts, '/auth/sign-in/social')).toBe(1)
    expect(countPosts(posts, '/auth/sso/delete-account')).toBe(0)
    expect(mockDatabase.getCurrentUser()?.id).toBe(actor.id)
    expect(queryClient.getQueryData(['bookmarks', 'private'])).toEqual({
      owner: actor.id
    })
  })
  it('탈퇴는 최종 클릭 한 번만 보내고 로그인 화면에 접수 안내를 보이며 개인 cache를 지운다', async () => {
    freshActor()
    const user = userEvent.setup()
    const posts = vi.spyOn(apiClient, 'post')
    const router = renderAccount()
    const dialog = await openDeleteDialog(user)
    expect(
      within(dialog).getByRole('listitem', { current: 'step' })
    ).toHaveTextContent('마지막 확인')
    expect(countPosts(posts, '/auth/sso/delete-account')).toBe(0)
    queryClient.setQueryData(['bookmarks', 'private'], { private: true })
    await user.dblClick(
      within(dialog).getByRole('button', { name: '회원 탈퇴' })
    )
    // JLP-845: the notice carries the erasure date, 7 days on.
    await screen.findByText(
      /^탈퇴 신청을 받았어요\. \d+월 \d+일 .+시에 모두 삭제돼요\. 그 전에 다시 로그인하면 되살릴 수 있어요\.$/u
    )
    expect(router.state.location.pathname).toBe('/login')
    expect(countPosts(posts, '/auth/sso/delete-account')).toBe(1)
    expect(useAppStore.getState().currentUser).toBeNull()
    expect(queryClient.getQueryData(['bookmarks', 'private'])).toBeUndefined()
  })
  it('JLP-847 접수 확인 조회가 실패해도 날짜 없이 접수 안내를 보인다', async () => {
    freshActor()
    mockServer.use(
      http.get('*/api/auth/sso/deletion', () =>
        HttpResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 })
      )
    )
    const user = userEvent.setup()
    const router = renderAccount()
    const dialog = await openDeleteDialog(user)
    await user.click(within(dialog).getByRole('button', { name: '회원 탈퇴' }))
    await screen.findByText(
      '탈퇴 신청을 받았어요. 7일 뒤 모두 삭제돼요. 그 전에 다시 로그인하면 되살릴 수 있어요.'
    )
    expect(router.state.location.pathname).toBe('/login')
    expect(useAppStore.getState().currentUser).toBeNull()
  })
  it('JLP-845 ⑦ 마지막 관리자 409는 창을 두고 알린 뒤 [회원 탈퇴]를 끈다', async () => {
    freshActor()
    mockServer.use(
      http.post('*/api/auth/sso/delete-account', () =>
        HttpResponse.json(
          { code: 'SSO_LAST_ADMIN_DELETION_BLOCKED' },
          { status: 409 }
        )
      )
    )
    const user = userEvent.setup()
    const posts = vi.spyOn(apiClient, 'post')
    renderAccount()
    const dialog = await openDeleteDialog(user)
    const confirm = within(dialog).getByRole('button', { name: '회원 탈퇴' })
    await user.click(confirm)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '관리자가 한 명뿐이라 지금은 탈퇴할 수 없어요. 다른 회원을 관리자로 먼저 지정한 뒤 다시 시도해 주세요.'
    )
    expect(confirm).toBeDisabled()
    const cancel = within(dialog).getByRole('button', { name: '취소' })
    expect(cancel).toBeEnabled()
    await waitFor(() => expect(cancel).toHaveFocus())
    expect(countPosts(posts, '/auth/sso/delete-account')).toBe(1)
    expect(useAppStore.getState().currentUser).not.toBeNull()
  })
  it('JLP-845 ⑥ 마지막 활성 관리자는 [회원 탈퇴]가 미리 꺼지고 이유와 이어진다', async () => {
    mockDatabase.loginAs('USER')
    const caps = mockDatabase.ssoAccounts.capabilities()
    mockServer.use(
      http.get('*/api/auth/sso/accounts', () =>
        HttpResponse.json({
          ...caps,
          canDelete: false,
          deletionBlockedReason: 'LAST_ACTIVE_ADMIN'
        })
      )
    )
    renderAccount()
    const deletion = await screen.findByRole('button', { name: '회원 탈퇴' })
    await waitFor(() => expect(deletion).toBeDisabled())
    expect(deletion).toHaveAccessibleDescription(
      '관리자가 한 명뿐이라 지금은 탈퇴할 수 없어요. 다른 회원을 관리자로 먼저 지정한 뒤 다시 시도해 주세요.'
    )
  })
  it('403 fresh 요구는 이동이나 탈퇴 반복 없이 ① 본인 확인으로 되돌린다', async () => {
    linkedActor()
    const caps = mockDatabase.ssoAccounts.capabilities()
    mockServer.use(
      http.get('*/api/auth/sso/accounts', () =>
        HttpResponse.json({ ...caps, freshVerified: true })
      ),
      http.post('*/api/auth/sso/delete-account', () =>
        HttpResponse.json(
          { code: 'SSO_FRESH_REQUIRED', message: '확인 필요' },
          { status: 403 }
        )
      )
    )
    const user = userEvent.setup()
    const posts = vi.spyOn(apiClient, 'post')
    const router = renderAccount()
    const dialog = await openDeleteDialog(user)
    await user.click(within(dialog).getByRole('button', { name: '회원 탈퇴' }))
    await within(dialog).findByRole('button', {
      name: 'Google로 확인하기'
    })
    expect(router.state.location.pathname).toBe('/account')
    expect(countPosts(posts, '/auth/sso/delete-account')).toBe(1)
    expect(countPosts(posts, '/auth/sso/unlink')).toBe(0)
  })
  it('503 결과 불명 후 다시 확인은 GET만 실행하고 탈퇴를 반복하지 않는다', async () => {
    freshActor()
    let finish: (() => void) | undefined
    mockServer.use(
      http.post('*/api/auth/sso/delete-account', async () => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return HttpResponse.json(
          { code: 'SSO_ACCOUNT_OPERATION_UNAVAILABLE', message: '미확정' },
          { status: 503 }
        )
      })
    )
    const reads = deletionReads()
    const user = userEvent.setup()
    const posts = vi.spyOn(apiClient, 'post')
    renderAccount()
    const dialog = await openDeleteDialog(user)
    await user.click(within(dialog).getByRole('button', { name: '회원 탈퇴' }))
    await waitFor(() => expect(finish).toBeDefined())
    await act(async () => finish?.())
    await within(dialog).findByRole('alert')
    expect(
      within(dialog).queryByRole('button', { name: '회원 탈퇴' })
    ).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '다시 확인' }))
    await waitFor(() => expect(reads()).toBe(1))
    expect(countPosts(posts, '/auth/sso/delete-account')).toBe(1)
    expect(mockDatabase.getCurrentUser()).not.toBeNull()
  })
  it('복귀 query만으로 fresh를 부여하거나 mutation하지 않고 /account로 넘긴 뒤 주소를 정리한다', async () => {
    mockDatabase.loginAs('USER')
    const posts = vi.spyOn(apiClient, 'post')
    const router = renderAccount('/login?ssoAccountFresh=REAUTHENTICATED')
    await screen.findByText('로그인 중')
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(router.state.location.pathname).toBe('/account')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockDatabase.ssoAccounts.capabilities().freshVerified).toBe(false)
    expect(posts).not.toHaveBeenCalled()
  })
  it('?reauth=delete 복귀는 서버가 확인을 기록했을 때만 같은 대화상자를 ② 단계로 다시 연다', async () => {
    freshActor()
    const posts = vi.spyOn(apiClient, 'post')
    const router = renderAccount(
      '/login?reauth=delete&ssoAccountFresh=REAUTHENTICATED'
    )
    const dialog = await screen.findByRole('dialog', {
      name: '회원 탈퇴할까요?'
    })
    expect(
      within(dialog).getByRole('listitem', { current: 'step' })
    ).toHaveTextContent('마지막 확인')
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      '본인 확인을 마쳤어요.'
    )
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(router.state.location.pathname).toBe('/account')
    expect(posts).not.toHaveBeenCalled()
  })
  it('복귀 주소만 성공이고 서버 확인이 없으면 ① 단계에서 실패를 알린다', async () => {
    mockDatabase.loginAs('USER')
    renderAccount('/login?reauth=delete&ssoAccountFresh=REAUTHENTICATED')
    const dialog = await screen.findByRole('dialog', {
      name: '회원 탈퇴할까요?'
    })
    expect(
      within(dialog).getByRole('listitem', { current: 'step' })
    ).toHaveTextContent('본인 확인')
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      '본인 확인을 마치지 못했어요. 다시 시도해 주세요.'
    )
    expect(
      within(dialog).getByRole('button', { name: 'Google로 확인하기' })
    ).toBeEnabled()
    expect(mockDatabase.ssoAccounts.capabilities().freshVerified).toBe(false)
  })
  it.each([
    ['CANCELLED', '본인 확인을 취소했어요.', 'status'],
    ['FAILED', '본인 확인을 마치지 못했어요. 다시 시도해 주세요.', 'alert'],
    [
      'INVALID_CALLBACK',
      '시간이 지나 확인이 끝났어요. 다시 시도해 주세요.',
      'alert'
    ]
  ] as const)(
    '%s 복귀는 같은 대화상자의 ① 단계에 그 결과를 보여 준다(실패·만료는 빨간 상자, 취소는 중립 상자)',
    async (outcome, copy, role) => {
      mockDatabase.loginAs('USER')
      renderAccount('/login?reauth=delete&ssoAccountFresh=' + outcome)
      const dialog = await screen.findByRole('dialog', {
        name: '회원 탈퇴할까요?'
      })
      expect(dialog).toHaveTextContent(copy)
      const box = within(dialog).getByText(copy)
      expect(box).toHaveAttribute('role', role)
      expect(box).toHaveClass('auth-notice')
      if (role === 'alert') expect(box).toHaveClass('auth-error')
      else expect(box).not.toHaveClass('auth-error')
      expect(
        within(dialog).queryByRole('button', { name: '회원 탈퇴' })
      ).not.toBeInTheDocument()
    }
  )
  it('알 수 없는 reauth 값은 대화상자를 열지 않는다', async () => {
    freshActor()
    const router = renderAccount(
      '/login?reauth=unlink:kakao&ssoAccountFresh=REAUTHENTICATED'
    )
    await screen.findByText('로그인 중')
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('복귀 CANCELLED는 기존 회원·개인 cache를 지우거나 mutation하지 않고 안내만 한다', async () => {
    const actor = mockDatabase.loginAs('USER')
    const posts = vi.spyOn(apiClient, 'post')
    const router = renderAccount()
    await screen.findByText('로그인 중')
    queryClient.setQueryData(['bookmarks', 'private'], { owner: actor.id })
    await act(async () => {
      await router.navigate('/login?ssoAccountFresh=CANCELLED')
    })
    await screen.findByText('본인 확인을 취소했어요.')
    expect(router.state.location.pathname).toBe('/account')
    expect(queryClient.getQueryData(['bookmarks', 'private'])).toEqual({
      owner: actor.id
    })
    expect(mockDatabase.getCurrentUser()?.id).toBe(actor.id)
    expect(posts).not.toHaveBeenCalled()
  })
  it('계정과 데이터 안내는 정적 문서라 비회원도 오류 없이 보고 receipt를 읽지 않는다', async () => {
    const reads = deletionReads()
    const posts = vi.spyOn(apiClient, 'post')
    renderAccount('/account/data')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: '내 데이터는 어떻게 처리되나요?'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '보내 주신 문제 신고는 설명을 지우고 계정과 연결을 끊은 채 남아요.'
      )
    ).toBeInTheDocument()
    // JLP-850: the same top tabs as the other information pages, with no
    // link back to My (the bottom tab bar does that).
    const tabs = screen.getByRole('navigation', { name: '서비스 안내' })
    expect(
      within(tabs).getByRole('link', { name: '계정·데이터' })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      screen.getByRole('link', { name: '개인정보 처리방침 보기' })
    ).toHaveClass('min-h-11')
    expect(
      screen.queryByRole('link', { name: '마이페이지로' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(reads()).toBe(0)
    expect(posts).not.toHaveBeenCalled()
  })
  it('로그아웃 취소는 유지하고 확인 후 fresh /me의 GUEST와 cache 정리를 확인한다', async () => {
    const existing = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(existing)
    const user = userEvent.setup()
    const router = renderAccount()
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
    expect(await screen.findByText('학습 홈')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(
      await screen.findByRole('region', { name: /알림|Notifications/ })
    ).toHaveTextContent('로그아웃했어요.')
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
    renderAccount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '로그아웃' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '로그아웃' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '로그아웃됐는지 확인하지 못했어요.'
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

  it('요청 extra field와 공급자 URL 불일치를 거부한다', async () => {
    const posts = vi.spyOn(apiClient, 'post')
    const input = {
      purpose: 'ACCOUNT_FRESH' as const,
      provider: 'apple' as const,
      role: 'ADMIN'
    }
    await expect(startAccountSso(input)).rejects.toThrow()
    expect(posts).not.toHaveBeenCalled()
    mockServer.use(
      http.post('*/api/auth/sign-in/social', () =>
        HttpResponse.json({
          url:
            'https://accounts.google.com/o/oauth2/v2/auth?state=' +
            's'.repeat(43) +
            '&nonce=' +
            'n'.repeat(43) +
            '&code_challenge=' +
            'c'.repeat(43) +
            '&code_challenge_method=S256',
          redirect: true
        })
      )
    )
    await expect(
      startAccountSso({ purpose: 'ACCOUNT_FRESH', provider: 'apple' })
    ).rejects.toMatchObject({ status: 422 })
  })
})

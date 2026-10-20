import { act } from '@testing-library/react'
import { accountMutationRequest } from '@app/login/accountFlowErrors'
import { commitCanonicalAuth } from '@app/login/authSession'
import { writeUiLocalePreference } from '@libs/localeStorage'
import { Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { apiClient } from '@api/config'
import { startAccountSso } from '@api/auth/startAccountSso'
import { loginRoutes } from '@app/login/router'
import { queryClient } from '@libs/queryClient'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { AuthErrorHandlerProvider } from '@provider/AuthErrorHandlerProvider'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { I18nProvider } from '@provider/I18nProvider'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const renderAccount = (entry = '/login') => {
  const router = createMemoryRouter(
    [
      {
        element: (
          <ProtectedRouteProvider>
            <AuthErrorHandlerProvider />
            <Outlet />
          </ProtectedRouteProvider>
        ),
        children: loginRoutes
      }
    ],
    { initialEntries: [entry] }
  )
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <Suspense fallback={<p>확인 중</p>}>
          <RouterProvider router={router} />
        </Suspense>
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
describe('계정 연결·해제·탈퇴 소비', () => {
  beforeAll(async () => {
    // Await the lazy route module before the first DOM query starts its timeout.
    await import('@app/login/page')
  })

  it('서버 공급자 불가·관리 작업 제한에는 이유와 GET 재조회만 제공한다', async () => {
    mockDatabase.loginAs('ADMIN')
    const caps = mockDatabase.ssoAccounts.capabilities()
    let reads = 0
    mockServer.use(
      http.get('*/api/auth/sso/accounts', () => {
        reads += 1
        return HttpResponse.json({
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
      })
    )
    const user = userEvent.setup()
    const posts = vi.spyOn(apiClient, 'post')
    renderAccount()
    const unlink = await screen.findByRole('button', {
      name: 'Google 연결 해제'
    })
    expect(unlink).toBeDisabled()
    expect(unlink).toHaveAccessibleDescription(
      '다른 로그인 방법을 현재 이용할 수 없어 연결을 해제할 수 없어요.'
    )
    const deletion = screen.getByRole('button', { name: '회원 탈퇴' })
    expect(deletion).toBeDisabled()
    expect(deletion).toHaveAccessibleDescription(
      '진행 중인 관리자 작업이 있어 지금은 탈퇴할 수 없어요.'
    )
    await user.click(screen.getByRole('button', { name: '다시 확인' }))
    await waitFor(() => expect(reads).toBe(2))
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
      '기존 학습 기록을 연결하지 못했어요. 로그인 방법 전환 안내를 확인해 주세요.'
    )
    expect(
      screen.getByRole('button', { name: '계속하려면 다시 로그인해 주세요.' })
    ).toBeDisabled()
    expect(screen.queryByLabelText(/비밀번호|이메일/)).not.toBeInTheDocument()
  })
  it('일본어에도 같은 연결 상태와 마지막 수단 이유를 제공한다', async () => {
    writeUiLocalePreference('ja')
    mockDatabase.loginAs('USER')
    renderAccount()
    const unlink = await screen.findByRole('button', {
      name: 'Google 連携を解除'
    })
    expect(unlink).toBeDisabled()
    expect(unlink).toHaveAccessibleDescription(
      '最後のログイン方法は解除できません。'
    )
    expect(screen.getByRole('button', { name: 'Appleを連携' })).toBeEnabled()
  })
  it.each(['ssoAccountFresh=CANCELLED', 'ssoAccountLink=FAILED'])(
    '복귀 %s는 기존 회원·개인 cache를 지우거나 mutation하지 않는다',
    async (query) => {
      const actor = mockDatabase.loginAs('USER')
      const posts = vi.spyOn(apiClient, 'post')
      const router = renderAccount()
      await screen.findByRole('button', { name: 'Apple 연결' })
      queryClient.setQueryData(['bookmarks', 'private'], { owner: actor.id })
      await act(async () => {
        await router.navigate('/login?' + query)
      })
      expect(queryClient.getQueryData(['bookmarks', 'private'])).toEqual({
        owner: actor.id
      })
      expect(mockDatabase.getCurrentUser()?.id).toBe(actor.id)
      expect(posts).not.toHaveBeenCalled()
    }
  )
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
    '%ipx 상태에서 마지막 수단 이유와 안전한 취소·포커스 복원을 제공한다',
    async (width) => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: width
      })
      mockDatabase.loginAs('USER')
      const user = userEvent.setup()
      const posts = vi.spyOn(apiClient, 'post')
      renderAccount()
      const unlink = await screen.findByRole('button', {
        name: 'Google 연결 해제'
      })
      expect(unlink).toBeDisabled()
      expect(unlink).toHaveAccessibleDescription(
        '마지막 로그인 방법은 해제할 수 없어요.'
      )
      const link = screen.getByRole('button', { name: 'Apple 연결' })
      await user.click(link)
      const dialog = screen.getByRole('dialog')
      expect(
        within(dialog).queryByRole('button', { name: 'Apple로 계속하기' })
      ).not.toBeInTheDocument()
      expect(
        within(dialog).getByRole('button', { name: 'Google로 계속하기' })
      ).toBeEnabled()
      expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus()
      fireEvent(dialog, new Event('cancel', { cancelable: true }))
      await waitFor(() => expect(link).toHaveFocus())
      expect(posts).not.toHaveBeenCalled()
    }
  )
  it('기존 연결의 fresh 뒤 사용자 재클릭으로만 두 번째 방법을 연결하고 ID·개인 cache를 보존한다', async () => {
    const actor = mockDatabase.loginAs('USER')
    const user = userEvent.setup()
    const posts = vi.spyOn(apiClient, 'post')
    renderAccount()
    await user.click(await screen.findByRole('button', { name: 'Apple 연결' }))
    queryClient.setQueryData(['bookmarks', 'private'], { owner: actor.id })
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Google로 계속하기'
      })
    )
    await waitFor(() =>
      expect(mockDatabase.ssoAccounts.capabilities().freshVerified).toBe(true)
    )
    expect(countPosts(posts, '/auth/sign-in/social')).toBe(1)
    expect(mockDatabase.ssoAccounts.capabilities().providers).toHaveLength(1)
    await user.click(await screen.findByRole('button', { name: 'Apple 연결' }))
    await screen.findByRole('button', { name: 'Apple 연결 해제' })
    expect(mockDatabase.getCurrentUser()?.id).toBe(actor.id)
    expect(queryClient.getQueryData(['bookmarks', 'private'])).toEqual({
      owner: actor.id
    })
    expect(mockDatabase.ssoAccounts.capabilities().freshVerified).toBe(false)
    expect(countPosts(posts, '/auth/sso/unlink')).toBe(0)
    expect(countPosts(posts, '/auth/sso/delete-account')).toBe(0)
  })
  it('해제 확인을 취소할 수 있고 최종 클릭 뒤 개인 cache를 지워 로그인으로 돌아간다', async () => {
    linkedActor()
    const user = userEvent.setup()
    const posts = vi.spyOn(apiClient, 'post')
    const router = renderAccount()
    const trigger = await screen.findByRole('button', {
      name: 'Google 연결 해제'
    })
    await user.click(trigger)
    expect(
      within(screen.getByRole('dialog')).getByText(/Apple로 로그인해 주세요/)
    ).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '취소' })
    )
    expect(trigger).toHaveFocus()
    queryClient.setQueryData(['wrong-note', 'private'], { private: true })
    await user.click(trigger)
    await user.dblClick(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '연결 해제'
      })
    )
    await screen.findByRole('button', { name: 'Apple로 계속하기' })
    expect(countPosts(posts, '/auth/sso/unlink')).toBe(1)
    expect(router.state.location.pathname).toBe('/login')
    expect(useAppStore.getState().currentUser).toBeNull()
    expect(queryClient.getQueryData(['wrong-note', 'private'])).toBeUndefined()
  })
  it('403 fresh 요구는 forbidden 이동이나 자동 해제 없이 재인증 안내로 소비한다', async () => {
    linkedActor()
    const caps = mockDatabase.ssoAccounts.capabilities()
    mockServer.use(
      http.get('*/api/auth/sso/accounts', () =>
        HttpResponse.json({
          ...caps,
          freshVerified: true,
          unlinkRequiresFresh: true
        })
      ),
      http.post('*/api/auth/sso/unlink', () =>
        HttpResponse.json(
          { code: 'SSO_FRESH_REQUIRED', message: '확인 필요' },
          { status: 403 }
        )
      )
    )
    const user = userEvent.setup()
    const posts = vi.spyOn(apiClient, 'post')
    const router = renderAccount()
    await user.click(
      await screen.findByRole('button', { name: 'Google 연결 해제' })
    )
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '연결 해제'
      })
    )
    await within(screen.getByRole('dialog')).findByRole('button', {
      name: 'Google로 계속하기'
    })
    expect(router.state.location.pathname).toBe('/login')
    expect(countPosts(posts, '/auth/sso/unlink')).toBe(1)
  })
  it('탈퇴는 최종 클릭 뒤 202 접수로만 알리고 private receipt를 읽으며 개인 cache를 지운다', async () => {
    freshActor()
    const user = userEvent.setup()
    const posts = vi.spyOn(apiClient, 'post')
    const router = renderAccount()
    await user.click(await screen.findByRole('button', { name: '회원 탈퇴' }))
    expect(countPosts(posts, '/auth/sso/delete-account')).toBe(0)
    queryClient.setQueryData(['bookmarks', 'private'], { private: true })
    await user.dblClick(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '회원 탈퇴'
      })
    )
    await screen.findByText('회원 탈퇴 요청을 접수했어요.')
    expect(
      screen.queryByText('회원 탈퇴가 완료됐어요.')
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('연결 정리가 아직 완료되지 않았어요.')
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/account/data')
    expect(countPosts(posts, '/auth/sso/delete-account')).toBe(1)
    expect(useAppStore.getState().currentUser).toBeNull()
    expect(queryClient.getQueryData(['bookmarks', 'private'])).toBeUndefined()
  })
  it('503 결과 불명 후 다시 확인은 GET만 실행하고 탈퇴를 반복하지 않는다', async () => {
    freshActor()
    mockServer.use(
      http.post('*/api/auth/sso/delete-account', () =>
        HttpResponse.json(
          { code: 'SSO_ACCOUNT_OPERATION_UNAVAILABLE', message: '미확정' },
          { status: 503 }
        )
      )
    )
    const user = userEvent.setup()
    const posts = vi.spyOn(apiClient, 'post')
    renderAccount()
    await user.click(await screen.findByRole('button', { name: '회원 탈퇴' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '회원 탈퇴'
      })
    )
    await screen.findByRole('alert')
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '다시 확인'
      })
    )
    await waitFor(() =>
      expect(countPosts(posts, '/auth/sso/delete-account')).toBe(1)
    )
    expect(mockDatabase.getCurrentUser()).not.toBeNull()
  })
  it('복귀 query만으로 fresh를 부여하거나 mutation하지 않고 주소를 정리한다', async () => {
    mockDatabase.loginAs('USER')
    const posts = vi.spyOn(apiClient, 'post')
    const router = renderAccount('/login?ssoAccountFresh=REAUTHENTICATED')
    await screen.findByRole('button', { name: 'Apple 연결' })
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(mockDatabase.ssoAccounts.capabilities().freshVerified).toBe(false)
    expect(posts).not.toHaveBeenCalled()
  })
  it.each([
    ['PENDING', '연결 정리가 아직 완료되지 않았어요.'],
    [
      'FAILED',
      '연결 정리를 완료하지 못했어요. 앱 탈퇴 상태와 별도로 확인해 주세요.'
    ],
    ['COMPLETED', '이 로그인 방법의 연결 정리가 완료됐어요.']
  ])('앱 완료와 공급자 %s를 분리한다', async (status, label) => {
    mockServer.use(
      http.get('*/api/auth/sso/deletion', () =>
        HttpResponse.json({
          appStatus: 'DELETED',
          providerCleanup: [{ provider: 'apple', status }]
        })
      )
    )
    renderAccount('/account/data')
    await screen.findByText('회원 탈퇴가 완료됐어요.')
    expect(screen.getByText(label)).toBeInTheDocument()
  })
  it('receipt 없음은 완료나 재신청으로 바꾸지 않는다', async () => {
    const posts = vi.spyOn(apiClient, 'post')
    renderAccount('/account/data')
    await screen.findByText(
      '탈퇴 결과를 확인할 수 없어요. 요청을 반복하지 말고 상태를 다시 확인해 주세요.'
    )
    expect(posts).not.toHaveBeenCalled()
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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, delay } from 'msw'
import type { ReactElement } from 'react'
import { commitCanonicalAuth } from '@app/login/authSession'
import { authQueries } from '@app/login/queries/authQueries'
import { useDemoAuth } from '@provider/ProtectedRouteProvider'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { demoUsers } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'
import { MOCK_DATABASE_STORAGE_KEY } from '@libs/storage'
import { useAppStore } from '@store/index'

const createClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })

const AuthProbe = ({
  observedRoles
}: {
  observedRoles?: string[]
}): ReactElement => {
  const { role } = useDemoAuth()
  observedRoles?.push(role)
  return <p>현재 역할: {role}</p>
}

const renderProbe = (
  client: QueryClient,
  observedRoles?: string[]
): ReturnType<typeof render> =>
  render(
    <QueryClientProvider client={client}>
      <ProtectedRouteProvider>
        <AuthProbe observedRoles={observedRoles} />
      </ProtectedRouteProvider>
    </QueryClientProvider>
  )

describe('canonical auth synchronization', () => {
  it('persisted ADMIN보다 canonical guest를 첫 ready render부터 우선한다', async () => {
    const admin = mockDatabase.loginAs('ADMIN')
    useAppStore.getState().setCurrentUser(admin)
    mockDatabase.logout()
    const roles: string[] = []

    renderProbe(createClient(), roles)

    expect(await screen.findByText('현재 역할: GUEST')).toBeInTheDocument()
    expect(roles).not.toContain('ADMIN')
    await waitFor(() => expect(useAppStore.getState().currentUser).toBeNull())
  })

  it('진행 중인 이전 current-user 조회가 명시적 auth 전환을 덮어쓰지 못한다', async () => {
    const user = demoUsers.find(({ role }) => role === 'USER')
    const admin = demoUsers.find(({ role }) => role === 'ADMIN')
    expect(user).toBeDefined()
    expect(admin).toBeDefined()
    if (!user || !admin) {
      return
    }

    const client = createClient()
    let releasePreviousRequest: (() => void) | undefined
    const previousRequest = client.fetchQuery({
      queryKey: authQueries.currentUser().queryKey,
      queryFn: async () => {
        await new Promise<void>((resolve) => {
          releasePreviousRequest = resolve
        })
        return admin
      }
    })
    await waitFor(() => expect(releasePreviousRequest).toBeDefined())

    await commitCanonicalAuth(client, user, {
      forceClear: true,
      forcePracticeReset: true
    })
    releasePreviousRequest?.()
    await previousRequest.catch(() => undefined)

    expect(client.getQueryData(authQueries.currentUser().queryKey)).toEqual(
      user
    )
    expect(useAppStore.getState().currentUser).toEqual(user)
  })

  it('초기 이전 역할 요청 중 storage event 한 번으로 새 canonical 조회를 시작한다', async () => {
    const user = demoUsers.find(({ role }) => role === 'USER')
    const admin = demoUsers.find(({ role }) => role === 'ADMIN')
    expect(user).toBeDefined()
    expect(admin).toBeDefined()
    if (!user || !admin) {
      return
    }

    useAppStore.getState().setCurrentUser(admin)
    let requestCount = 0
    let releasePreviousRequest: (() => void) | undefined
    mockServer.use(
      http.get('*/api/auth/current-user', async () => {
        requestCount += 1
        if (requestCount === 1) {
          await new Promise<void>((resolve) => {
            releasePreviousRequest = resolve
          })
          return HttpResponse.json(admin)
        }
        return HttpResponse.json(user)
      })
    )
    const observedRoles: string[] = []

    renderProbe(createClient(), observedRoles)
    await waitFor(() => expect(requestCount).toBe(1))

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: MOCK_DATABASE_STORAGE_KEY,
        newValue: 'canonical-user-changed'
      })
    )
    releasePreviousRequest?.()

    expect(await screen.findByText('현재 역할: USER')).toBeInTheDocument()
    expect(requestCount).toBe(2)
    expect(observedRoles).not.toContain('ADMIN')
  })

  it('첫 요청 중 뒤따른 storage event를 다시 조회해 최신 역할로 수렴한다', async () => {
    const user = demoUsers.find(({ role }) => role === 'USER')
    const admin = demoUsers.find(({ role }) => role === 'ADMIN')
    expect(user).toBeDefined()
    expect(admin).toBeDefined()
    let requestCount = 0
    let releaseFirstExternalRequest: (() => void) | undefined

    mockServer.use(
      http.get('*/api/auth/current-user', async () => {
        requestCount += 1
        if (requestCount === 1) {
          return HttpResponse.json(user)
        }
        if (requestCount === 2) {
          const snapshot = user
          await new Promise<void>((resolve) => {
            releaseFirstExternalRequest = resolve
          })
          return HttpResponse.json(snapshot)
        }
        return HttpResponse.json(admin)
      })
    )

    const client = createClient()
    renderProbe(client)
    expect(await screen.findByText('현재 역할: USER')).toBeInTheDocument()

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: MOCK_DATABASE_STORAGE_KEY,
        newValue: 'first-event'
      })
    )
    await waitFor(() => expect(requestCount).toBe(2))

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: MOCK_DATABASE_STORAGE_KEY,
        newValue: 'second-event'
      })
    )
    releaseFirstExternalRequest?.()

    expect(await screen.findByText('현재 역할: ADMIN')).toBeInTheDocument()
    expect(requestCount).toBe(3)
  })

  it('같은 사용자 Mock 데이터 변경은 data cache만 제거하고 현재 tab practice는 유지한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    const client = createClient()
    renderProbe(client)
    expect(await screen.findByText('현재 역할: USER')).toBeInTheDocument()

    useAppStore
      .getState()
      .beginPractice('same-tab-session', '2026-08-12T00:00:00.000Z')
    client.setQueryData(['wrong-note', 'list'], { owner: currentUser.id })
    mockDatabase.loginAs('USER')

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: MOCK_DATABASE_STORAGE_KEY,
        newValue: window.localStorage.getItem(MOCK_DATABASE_STORAGE_KEY)
      })
    )

    await waitFor(() =>
      expect(client.getQueryData(['wrong-note', 'list'])).toBeUndefined()
    )
    expect(useAppStore.getState().sessionId).toBe('same-tab-session')
    expect(screen.getByText('현재 역할: USER')).toBeInTheDocument()
  })

  it('canonical network failure에서는 안전한 기존 projection을 유지한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    mockServer.use(
      http.get('*/api/auth/current-user', async () => {
        await delay(1)
        return HttpResponse.error()
      })
    )

    renderProbe(createClient())

    expect(await screen.findByText('현재 역할: USER')).toBeInTheDocument()
    expect(useAppStore.getState().currentUser?.id).toBe(currentUser.id)
  })
})

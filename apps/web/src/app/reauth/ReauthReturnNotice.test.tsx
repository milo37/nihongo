import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { getCurrentUser } from '@nihongo/browser/api/auth/getCurrentUser/index'
import { adminFreshRemainingMs } from '@nihongo/browser/app/reauth/adminFreshTime'
import {
  REAUTH_STATUS_ID,
  ReauthReturnNotice
} from '@nihongo/browser/app/reauth/components/ReauthReturnNotice'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
import {
  grantMockAdminFreshForTesting,
  setMockSsoAccountForTesting
} from '@mocks/handlers/authHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'

// The admin app mounts this notice under the /admin basename.
const renderAdmin = (entry: string) => {
  const router = createMemoryRouter(
    [
      {
        path: '/questions',
        element: (
          <>
            <button id={REAUTH_STATUS_ID} type="button">
              상태
            </button>
            <ReauthReturnNotice />
          </>
        )
      }
    ],
    { basename: '/admin', initialEntries: [entry] }
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
const notice = () => document.querySelector<HTMLElement>('[data-reauth-result]')

describe('본인 확인 복귀 알림', () => {
  afterEach(() => vi.useRealTimers())

  it('서버가 확인한 성공은 8초 뒤 닫히고, 마우스가 올라가 있으면 기다린다', async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ['setTimeout', 'clearTimeout']
    })
    const actor = mockDatabase.loginAs('ADMIN')
    grantMockAdminFreshForTesting(actor.id)
    const router = renderAdmin(
      '/admin/questions?level=N2&page=2&ssoFresh=REAUTHENTICATED'
    )
    await screen.findByText(/본인 확인을 마쳤습니다\(30분 유효\)/u)
    // Only ssoFresh goes; the path keeps a single /admin basename.
    expect(router.state.location.pathname).toBe('/admin/questions')
    expect(router.state.location.search).toBe('?level=N2&page=2')
    await waitFor(() => expect(notice()).toHaveFocus())
    fireEvent.mouseEnter(notice()!)
    act(() => vi.advanceTimersByTime(9_000))
    expect(notice()).toBeInTheDocument()
    fireEvent.mouseLeave(notice()!)
    act(() => vi.advanceTimersByTime(8_000))
    await waitFor(() => expect(notice()).toBeNull())
    expect(screen.getByRole('button', { name: '상태' })).toHaveFocus()
  })

  it('주소만 성공이고 서버에 본인 확인이 없으면 실패로 알리고 다시 시도는 같은 화면으로 돌아온다', async () => {
    mockDatabase.loginAs('ADMIN')
    setMockSsoAccountForTesting('google', DEMO_ADMIN_ID)
    const starts: unknown[] = []
    mockServer.events.on('request:start', ({ request }) => {
      if (new URL(request.url).pathname === '/api/auth/sign-in/social')
        void request
          .clone()
          .json()
          .then((body: unknown) => starts.push(body))
    })
    const router = renderAdmin(
      '/admin/questions?level=N2&page=2&ssoFresh=REAUTHENTICATED'
    )
    await screen.findByText(
      '본인 확인을 마치지 못했습니다. 작업은 적용하지 않았습니다.'
    )
    expect(notice()).toHaveAttribute('data-reauth-result', 'failed')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    await screen.findByText(/본인 확인을 마쳤습니다\(30분 유효\)/u)
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0]).toEqual({
      purpose: 'ADMIN_FRESH',
      provider: 'google',
      callbackURL: '/admin/questions?level=N2&page=2'
    })
    await waitFor(() =>
      expect(router.state.location.search).toBe('?level=N2&page=2')
    )
    mockServer.events.removeAllListeners()
  })

  it('결과 조회가 실패하면 다시 확인으로 /me만 한 번 더 읽는다', async () => {
    const actor = mockDatabase.loginAs('ADMIN')
    grantMockAdminFreshForTesting(actor.id)
    let reads = 0
    mockServer.use(
      http.get('*/api/v1/me', () => {
        reads += 1
        return reads === 1
          ? HttpResponse.json(
              {
                code: 'SERVICE_UNAVAILABLE',
                message: '잠시 후',
                retryable: false
              },
              { status: 503 }
            )
          : undefined
      })
    )
    renderAdmin('/admin/questions?ssoFresh=REAUTHENTICATED')
    await screen.findByText('연결 문제로 결과를 확인하지 못했습니다.')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '다시 확인' }))
    await screen.findByText(/본인 확인을 마쳤습니다\(30분 유효\)/u)
    expect(reads).toBe(2)
  })

  it('실패 알림은 저절로 닫히지 않고 닫기로 상태 버튼에 포커스를 돌린다', async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ['setTimeout', 'clearTimeout']
    })
    mockDatabase.loginAs('ADMIN')
    renderAdmin('/admin/questions?ssoFresh=CANCELLED')
    await screen.findByText(
      '본인 확인을 취소했습니다. 작업은 적용하지 않았습니다.'
    )
    await waitFor(() => expect(notice()).toHaveFocus())
    act(() => vi.advanceTimersByTime(20_000))
    expect(notice()).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(notice()).toBeNull()
    expect(screen.getByRole('button', { name: '상태' })).toHaveFocus()
  })
})

describe('관리자 본인 확인 남은 시간', () => {
  it('서버 시각 기준으로 계산해 브라우저 시계 차이를 무시한다', () => {
    const user = {
      adminFreshUntil: '2026-11-08T10:30:00.000Z',
      adminServerTime: '2026-11-08T10:00:00.000Z'
    }
    // The browser clock runs 2 hours ahead of the server.
    const receivedAt = Date.parse('2026-11-08T12:00:00.000Z')
    expect(adminFreshRemainingMs(user, receivedAt, receivedAt)).toBe(
      30 * 60_000
    )
    expect(
      adminFreshRemainingMs(user, receivedAt, receivedAt + 26 * 60_000)
    ).toBe(4 * 60_000)
    expect(
      adminFreshRemainingMs(user, receivedAt, receivedAt + 31 * 60_000)
    ).toBe(0)
    expect(
      adminFreshRemainingMs({ adminFreshUntil: null }, receivedAt, receivedAt)
    ).toBe(0)
    expect(adminFreshRemainingMs(null, receivedAt)).toBe(0)
  })

  it('Mock /me는 관리자에게만 서버 시각을 주고 본인 확인 뒤 30분 창을 연다', async () => {
    const admin = mockDatabase.loginAs('ADMIN')
    const before = await getCurrentUser()
    expect(before?.adminFreshUntil).toBeNull()
    expect(typeof before?.adminServerTime).toBe('string')
    grantMockAdminFreshForTesting(admin.id)
    const after = await getCurrentUser()
    expect(adminFreshRemainingMs(after, Date.now())).toBeGreaterThan(
      29 * 60_000
    )
    mockDatabase.loginAs('USER')
    const learner = await getCurrentUser()
    expect(learner).not.toHaveProperty('adminServerTime')
  })
})

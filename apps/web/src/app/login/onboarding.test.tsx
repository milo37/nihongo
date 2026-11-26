import { Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { OnboardingCheck } from '@app/login/components/OnboardingCheck'
import { markOnboardingCheck } from '@app/login/onboardingMarker'
import { loginRoutes } from '@app/login/router'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { appI18n } from '@nihongo/browser/i18n/config'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { mockServer } from '@/test/server'

const renderAt = (entry: string) => {
  const router = createMemoryRouter(
    [
      {
        element: (
          <ProtectedRouteProvider>
            <OnboardingCheck />
            <Outlet />
          </ProtectedRouteProvider>
        ),
        children: [
          ...loginRoutes,
          { path: '/', element: <p>홈 도착</p> },
          { path: '/account', element: <p>마이 도착</p> },
          { path: '/wrong-notes', element: <p>오답노트 도착</p> }
        ]
      }
    ],
    { initialEntries: [entry] }
  )
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <Suspense fallback={<p>불러오는 중</p>}>
            <RouterProvider router={router} />
          </Suspense>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
  return router
}

const newMember = (): string => {
  const member = mockDatabase.loginAs('USER')
  mockDatabase.resetStudyGoal(member.id)
  return member.id
}

const recordWrites = () => {
  const writes: string[] = []
  const record = ({ request }: { request: Request }): void => {
    if (request.url.includes('/me/study-goal') && request.method !== 'GET')
      writes.push(`${request.method} ${new URL(request.url).pathname}`)
  }
  mockServer.events.on('request:start', record)
  return writes
}

describe('#1090 학습 목표', () => {
  beforeAll(async () => {
    await import('@app/login/page')
  })
  beforeEach(async () => {
    window.localStorage.removeItem('harumaru:ui-locale:v1')
    window.localStorage.removeItem('harumaru:last-practice:v1')
    window.sessionStorage.clear()
    await appI18n.changeLanguage('ko')
    mockDatabase.reset()
    queryClient.clear()
  })
  afterEach(() => {
    mockServer.events.removeAllListeners('request:start')
  })

  it('처음이면 제목에 초점, 급수 N2(데모 목표)·하루 10문제가 골라져 있고 10에서 −는 쓸 수 없다', async () => {
    newMember()
    renderAt('/onboarding?redirect=%2Fwrong-notes')
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: '하루에 조금씩, 같이 해 봐요'
    })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByRole('radio', { name: 'N2' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    const value = screen.getByRole('spinbutton', {
      name: '하루에 몇 문제 풀까요?'
    })
    expect(value).toHaveAttribute('aria-valuetext', '10문제')
    const minus = screen.getByRole('button', { name: '10문제 줄이기' })
    expect(minus).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(minus)
    expect(value).toHaveAttribute('aria-valuenow', '10')
    expect(screen.getByRole('button', { name: '시작하기' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: '나중에 할게요' })
    ).toBeInTheDocument()
  })

  it('[시작하기]는 고른 급수·하루 목표를 한 번 저장하고 원래 경로로 간다', async () => {
    newMember()
    const writes = recordWrites()
    const user = userEvent.setup()
    const router = renderAt('/onboarding?redirect=%2Fwrong-notes')
    await user.click(await screen.findByRole('radio', { name: 'N3' }))
    const plus = screen.getByRole('button', { name: '10문제 늘리기' })
    await user.click(plus)
    await user.click(plus)
    expect(
      screen.getByRole('spinbutton', { name: '하루에 몇 문제 풀까요?' })
    ).toHaveAttribute('aria-valuetext', '30문제')
    await user.dblClick(screen.getByRole('button', { name: '시작하기' }))
    expect(await screen.findByText('오답노트 도착')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/wrong-notes')
    expect(writes).toEqual(['PUT /api/v1/me/study-goal'])
    const userId = mockDatabase.getCurrentUser()?.id ?? ''
    expect(mockDatabase.getStudyGoal(userId)).toMatchObject({
      targetLevel: 'N3',
      dailyGoal: 30,
      onboardingRequired: false
    })
  })

  it('[나중에 할게요]는 건너뜀만 한 번 저장하고 원래 경로로 간다', async () => {
    newMember()
    const writes = recordWrites()
    renderAt('/onboarding?redirect=%2Fwrong-notes')
    await userEvent.click(
      await screen.findByRole('button', { name: '나중에 할게요' })
    )
    expect(await screen.findByText('오답노트 도착')).toBeInTheDocument()
    expect(writes).toEqual(['POST /api/v1/me/study-goal/skip'])
  })

  it('150에서 +는 쓸 수 없고 방향키로도 넘지 않는다', async () => {
    newMember()
    renderAt('/onboarding?redirect=%2F')
    const value = await screen.findByRole('spinbutton', {
      name: '하루에 몇 문제 풀까요?'
    })
    value.focus()
    await userEvent.keyboard('{End}{ArrowUp}')
    expect(value).toHaveAttribute('aria-valuenow', '150')
    expect(
      screen.getByRole('button', { name: '10문제 늘리기' })
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('저장이 실패하면 토스트로 알리고 그 자리에 둔다 (#1292)', async () => {
    newMember()
    mockServer.use(
      http.put('*/api/v1/me/study-goal', () =>
        HttpResponse.json(
          { success: false, error: { code: 'INTERNAL_SERVER_ERROR' } },
          { status: 500 }
        )
      )
    )
    const router = renderAt('/onboarding?redirect=%2Fwrong-notes')
    await userEvent.click(
      await screen.findByRole('button', { name: '시작하기' })
    )
    const region = await screen.findByRole('region', { name: '알림' })
    expect(
      await within(region).findByText('저장하지 못했어요. 다시 눌러 주세요.')
    ).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '시작하기' })).toBeEnabled()
    expect(router.state.location.pathname).toBe('/onboarding')
  })

  it('이미 답한 회원은 마이에서 열면 [저장]/[취소], [취소]는 보내지 않고 마이로 간다', async () => {
    const member = mockDatabase.loginAs('USER')
    mockDatabase.setStudyGoal(member.id, 'N3', 40)
    const writes = recordWrites()
    renderAt('/onboarding?redirect=%2Faccount')
    expect(
      await screen.findByRole('spinbutton', { name: '하루에 몇 문제 풀까요?' })
    ).toHaveAttribute('aria-valuetext', '40문제')
    expect(screen.getByRole('radio', { name: 'N3' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('button', { name: '저장' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(await screen.findByText('마이 도착')).toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('아직 답하지 않은 회원도 마이에서 열면 [저장]/[취소], [취소]는 아무것도 보내지 않는다', async () => {
    newMember()
    const writes = recordWrites()
    renderAt('/onboarding?redirect=%2Faccount')
    expect(
      await screen.findByRole('button', { name: '저장' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '나중에 할게요' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '시작하기' })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(await screen.findByText('마이 도착')).toBeInTheDocument()
    expect(writes).toEqual([])
  })

  it('이미 답한 회원이 로그인 복귀로 열면 묻지 않고 바로 넘긴다', async () => {
    mockDatabase.loginAs('USER')
    renderAt('/onboarding?redirect=%2Fwrong-notes')
    expect(await screen.findByText('오답노트 도착')).toBeInTheDocument()
  })

  it('비회원은 로그인으로 간다', async () => {
    mockDatabase.logout()
    const router = renderAt('/onboarding')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('로그인 직후 아직 답하지 않은 회원은 한 번 학습 목표로 보낸다', async () => {
    newMember()
    markOnboardingCheck()
    const router = renderAt('/wrong-notes')
    expect(
      await screen.findByRole('heading', {
        name: '하루에 조금씩, 같이 해 봐요'
      })
    ).toBeInTheDocument()
    expect(router.state.location.search).toBe('?redirect=%2Fwrong-notes')
  })

  it('로그인 표시가 없으면 학습 목표를 읽지 않는다', async () => {
    newMember()
    const reads: string[] = []
    mockServer.events.on('request:start', ({ request }) => {
      if (request.url.includes('/me/study-goal')) reads.push(request.url)
    })
    renderAt('/wrong-notes')
    expect(await screen.findByText('오답노트 도착')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(reads).toEqual([])
  })
})

// #1046: a browser that can take push. `subscribed` starts this device on;
// `registered: false` is a page whose service worker never registered.
const fakePush = ({
  permission = 'default',
  answer = 'granted',
  subscribed = false,
  registered = true
}: {
  permission?: NotificationPermission
  answer?: NotificationPermission
  subscribed?: boolean
  registered?: boolean
} = {}) => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/device-1'
  const unsubscribe = vi.fn(async () => true)
  const subscription = {
    endpoint,
    unsubscribe,
    toJSON: () => ({
      endpoint,
      keys: { p256dh: 'B'.padEnd(87, 'p'), auth: 'a'.padEnd(22, 'u') }
    })
  }
  let current = subscribed ? subscription : null
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => {
      current = subscription
      return subscription
    })
  }
  const registration = { pushManager }
  const notification = {
    permission,
    requestPermission: vi.fn(async () => {
      notification.permission = answer
      return answer
    })
  }
  vi.stubGlobal('Notification', notification)
  vi.stubGlobal('PushManager', class {})
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () =>
        registered ? registration : undefined
      ),
      ready: registered
        ? Promise.resolve(registration)
        : new Promise<never>(() => undefined)
    }
  })
  return { pushManager, unsubscribe, notification }
}

const recordPush = () => {
  const sent: { method: string; body: unknown }[] = []
  mockServer.events.on('request:start', ({ request }) => {
    if (!request.url.includes('/push/subscription')) return
    void request
      .clone()
      .json()
      .then((body: unknown) => sent.push({ method: request.method, body }))
  })
  return sent
}

describe('#1046 아침 8시 알림 스위치', () => {
  beforeAll(async () => {
    await import('@app/login/page')
  })
  beforeEach(async () => {
    window.localStorage.removeItem('harumaru:ui-locale:v1')
    window.sessionStorage.clear()
    await appI18n.changeLanguage('ko')
    mockDatabase.reset()
    queryClient.clear()
  })
  afterEach(() => {
    mockServer.events.removeAllListeners('request:start')
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  it('알림을 못 쓰는 브라우저에서는 스위치가 없다', async () => {
    newMember()
    renderAt('/onboarding?redirect=%2F')
    await screen.findByRole('spinbutton', { name: '하루에 몇 문제 풀까요?' })
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('서버에 알림이 없으면(설정 읽기 404) 스위치도 오류 토스트도 없다', async () => {
    newMember()
    fakePush()
    mockServer.use(
      http.get('*/api/v1/push/config', () =>
        HttpResponse.json(
          { code: 'NOT_FOUND', message: '없음' },
          { status: 404 }
        )
      )
    )
    renderAt('/onboarding?redirect=%2F')
    await screen.findByRole('spinbutton', { name: '하루에 몇 문제 풀까요?' })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: '알림' })
    ).not.toBeInTheDocument()
  })

  it('켜면 권한을 묻고, [시작하기]가 목표와 함께 이 기기를 구독한다', async () => {
    newMember()
    const push = fakePush()
    const sent = recordPush()
    const user = userEvent.setup()
    renderAt('/onboarding?redirect=%2Fwrong-notes')
    const toggle = await screen.findByRole('switch', {
      name: '아침 8시에 알려 드릴까요?'
    })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    expect(push.notification.requestPermission).toHaveBeenCalledTimes(1)
    expect(toggle).toBeChecked()
    expect(push.pushManager.subscribe).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '시작하기' }))
    expect(await screen.findByText('오답노트 도착')).toBeInTheDocument()
    expect(push.pushManager.subscribe).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(sent).toEqual([
        {
          method: 'PUT',
          body: expect.objectContaining({
            endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
            locale: 'ko'
          })
        }
      ])
    )
    // The PUT 204 body is empty: no failure toast.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(
      screen.queryByText(
        '알림을 켜지 못했어요. 목표 정하기에서 다시 켜 주세요.'
      )
    ).not.toBeInTheDocument()
  })

  it('권한을 거부하면 꺼진 채 흐려지고 설정 안내 한 줄, 저장해도 구독하지 않는다', async () => {
    newMember()
    const push = fakePush({ answer: 'denied' })
    const sent = recordPush()
    const user = userEvent.setup()
    renderAt('/onboarding?redirect=%2Fwrong-notes')
    const toggle = await screen.findByRole('switch')
    await user.click(toggle)
    await waitFor(() => expect(toggle).toBeDisabled())
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription(
      '브라우저 설정에서 알림을 허용해 주세요.'
    )
    await user.click(screen.getByRole('button', { name: '시작하기' }))
    expect(await screen.findByText('오답노트 도착')).toBeInTheDocument()
    expect(push.pushManager.subscribe).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('켜 둔 기기에서 끄고 [저장]하면 서버에서 지우고 구독을 푼다', async () => {
    const member = mockDatabase.loginAs('USER')
    mockDatabase.setStudyGoal(member.id, 'N3', 40)
    const push = fakePush({ permission: 'granted', subscribed: true })
    const sent = recordPush()
    const user = userEvent.setup()
    renderAt('/onboarding?redirect=%2Faccount')
    const toggle = await screen.findByRole('switch')
    await waitFor(() => expect(toggle).toBeChecked())
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('마이 도착')).toBeInTheDocument()
    expect(push.unsubscribe).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(sent).toEqual([
        {
          method: 'DELETE',
          body: { endpoint: 'https://fcm.googleapis.com/fcm/send/device-1' }
        }
      ])
    )
  })

  it('[취소]는 스위치를 바꿨어도 알림을 건드리지 않는다', async () => {
    const member = mockDatabase.loginAs('USER')
    mockDatabase.setStudyGoal(member.id, 'N3', 40)
    const push = fakePush({ permission: 'granted' })
    const sent = recordPush()
    const user = userEvent.setup()
    renderAt('/onboarding?redirect=%2Faccount')
    await user.click(await screen.findByRole('switch'))
    await user.click(screen.getByRole('button', { name: '취소' }))
    expect(await screen.findByText('마이 도착')).toBeInTheDocument()
    expect(push.pushManager.subscribe).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  it('홈 화면 추가 전 아이폰은 흐린 스위치와 안내 한 줄', async () => {
    newMember()
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1'
    )
    renderAt('/onboarding?redirect=%2F')
    const toggle = await screen.findByRole('switch')
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAccessibleDescription(
      '홈 화면에 추가하면 받을 수 있어요.'
    )
    vi.restoreAllMocks()
  })

  it('목표는 저장됐는데 구독이 실패하면 토스트 한 번 뒤 원래 경로로 간다', async () => {
    newMember()
    fakePush({ permission: 'granted' })
    mockServer.use(
      http.put('*/api/v1/push/subscription', () =>
        HttpResponse.json(
          { success: false, error: { code: 'INTERNAL_SERVER_ERROR' } },
          { status: 500 }
        )
      )
    )
    const user = userEvent.setup()
    renderAt('/onboarding?redirect=%2Fwrong-notes')
    await user.click(await screen.findByRole('switch'))
    await user.click(screen.getByRole('button', { name: '시작하기' }))
    expect(await screen.findByText('오답노트 도착')).toBeInTheDocument()
    const region = await screen.findByRole('region', { name: '알림' })
    expect(
      await within(region).findByText(
        '알림을 켜지 못했어요. 목표 정하기에서 다시 켜 주세요.'
      )
    ).toBeVisible()
  })

  it('서비스 워커가 없는 페이지는 기다리지 않고 토스트 뒤 원래 경로로 간다', async () => {
    newMember()
    const push = fakePush({ permission: 'granted', registered: false })
    const user = userEvent.setup()
    renderAt('/onboarding?redirect=%2Fwrong-notes')
    await user.click(await screen.findByRole('switch'))
    await user.click(screen.getByRole('button', { name: '시작하기' }))
    expect(await screen.findByText('오답노트 도착')).toBeInTheDocument()
    const region = await screen.findByRole('region', { name: '알림' })
    expect(
      await within(region).findByText(
        '알림을 켜지 못했어요. 목표 정하기에서 다시 켜 주세요.'
      )
    ).toBeVisible()
    expect(push.pushManager.subscribe).not.toHaveBeenCalled()
  })
})

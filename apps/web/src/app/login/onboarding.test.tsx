import { Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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
        <Suspense fallback={<p>불러오는 중</p>}>
          <RouterProvider router={router} />
        </Suspense>
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
      name: /^공부 목표를\s정해 볼까요\?$/u
    })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByRole('radio', { name: 'N2' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    const value = screen.getByRole('spinbutton', { name: '하루 목표' })
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
      screen.getByRole('spinbutton', { name: '하루 목표' })
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
    const value = await screen.findByRole('spinbutton', { name: '하루 목표' })
    value.focus()
    await userEvent.keyboard('{End}{ArrowUp}')
    expect(value).toHaveAttribute('aria-valuenow', '150')
    expect(
      screen.getByRole('button', { name: '10문제 늘리기' })
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('저장이 실패하면 작은 오류 한 줄을 보이고 그 자리에 둔다', async () => {
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
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '저장하지 못했어요. 다시 눌러 주세요.'
    )
    expect(router.state.location.pathname).toBe('/onboarding')
  })

  it('이미 답한 회원은 마이에서 열면 [저장]/[취소], [취소]는 보내지 않고 마이로 간다', async () => {
    const member = mockDatabase.loginAs('USER')
    mockDatabase.setStudyGoal(member.id, 'N3', 40)
    const writes = recordWrites()
    renderAt('/onboarding?redirect=%2Faccount')
    expect(
      await screen.findByRole('spinbutton', { name: '하루 목표' })
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
        name: /^공부 목표를\s정해 볼까요\?$/u
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

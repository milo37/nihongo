import { Suspense } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { AccountRestoreNotice } from '@app/login/components/AccountRestoreNotice'
import { loginRoutes } from '@app/login/router'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { appI18n } from '@nihongo/browser/i18n/config'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { mockServer } from '@/test/server'

const SCHEDULED = '2026-11-19T06:00:00.000Z'
const noStore = { headers: { 'Cache-Control': 'private, no-store' } }
const restoreState = () =>
  http.get('*/api/auth/sso/restore', () =>
    HttpResponse.json({ deletionScheduledAt: SCHEDULED }, noStore)
  )

const renderRestore = (
  entry = '/login?sso=RESTORE_AVAILABLE&redirect=%2Fwrong-notes'
) => {
  const router = createMemoryRouter(
    [
      {
        element: (
          <ProtectedRouteProvider>
            <AccountRestoreNotice />
            <Outlet />
          </ProtectedRouteProvider>
        ),
        children: [
          ...loginRoutes,
          { path: '/', element: <p>홈 도착</p> },
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
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </Suspense>
      </I18nProvider>
    </QueryClientProvider>
  )
  return router
}

describe('JLP-845 탈퇴 유예 계정 되살리기', () => {
  beforeAll(async () => {
    await import('@app/login/page')
  })
  beforeEach(async () => {
    window.localStorage.removeItem('harumaru:ui-locale:v1')
    await appI18n.changeLanguage('ko')
    mockDatabase.logout()
    queryClient.clear()
  })

  it('① 제목·굵은 날짜·버튼 둘, 제목에 초점, 주소의 sso는 남긴다', async () => {
    mockServer.use(restoreState())
    const router = renderRestore()
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: '탈퇴 신청한 계정이에요'
    })
    expect(heading).toHaveFocus()
    const date = new Intl.DateTimeFormat('ko-KR', {
      month: 'long',
      day: 'numeric',
      hour: 'numeric'
    }).format(new Date(SCHEDULED))
    expect(heading.nextElementSibling).toHaveTextContent(
      `${date}에 삭제될 예정이에요. 계정을 되살리면 학습 기록도 그대로 돌아와요.`
    )
    expect(screen.getByText(date).tagName).toBe('STRONG')
    expect(screen.getByRole('button', { name: '계정 되살리기' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: '그대로 탈퇴하기' })
    ).toBeEnabled()
    // No sign-in card or guest line while the choice is open.
    expect(
      screen.queryByRole('button', { name: 'Google로 계속하기' })
    ).not.toBeInTheDocument()
    expect(document.querySelector('.auth-guest-hint')).toBeNull()
    expect(router.state.location.search).toContain('sso=RESTORE_AVAILABLE')
  })

  it('[계정 되살리기]는 한 번만 보내고 회원으로 원래 경로에 가서 알린다', async () => {
    let posts = 0
    mockServer.use(
      restoreState(),
      http.post('*/api/auth/sso/restore', () => {
        posts += 1
        mockDatabase.loginAs('USER')
        return HttpResponse.json({ restored: true }, noStore)
      })
    )
    const user = userEvent.setup()
    const router = renderRestore()
    const restore = await screen.findByRole('button', {
      name: '계정 되살리기'
    })
    await user.dblClick(restore)
    expect(await screen.findByText('오답노트 도착')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/wrong-notes')
    expect(posts).toBe(1)
    expect(
      await screen.findByText('계정을 되살렸어요. 학습 기록도 그대로예요.')
    ).toBeInTheDocument()
  })

  it('② 처리 중에는 두 버튼 모두 꺼진다', async () => {
    let release: () => void = () => undefined
    mockServer.use(
      restoreState(),
      http.post(
        '*/api/auth/sso/restore',
        () =>
          new Promise<Response>((resolve) => {
            release = () =>
              resolve(
                HttpResponse.json(
                  { code: 'SSO_ACCOUNT_RESTORE_UNAVAILABLE' },
                  { status: 404 }
                )
              )
          })
      )
    )
    const user = userEvent.setup()
    renderRestore()
    await user.click(
      await screen.findByRole('button', { name: '계정 되살리기' })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '그대로 탈퇴하기' })
      ).toBeDisabled()
    )
    expect(screen.getByRole('button', { name: /잠시만요/u })).toBeDisabled()
    release()
    // ③ failure goes back to the sign-in card with an alert.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '계정을 되살리지 못했어요. 잠시 뒤 다시 로그인해 주세요.'
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Google로 계속하기' })
      ).toHaveFocus()
    )
  })

  it('④ 삭제가 시작된 뒤면 tooLate로 알리고 비회원 로그인 카드를 둔다', async () => {
    mockServer.use(
      restoreState(),
      http.post('*/api/auth/sso/restore', () =>
        HttpResponse.json(
          { code: 'SSO_ACCOUNT_RESTORE_TOO_LATE' },
          { status: 409 }
        )
      )
    )
    const user = userEvent.setup()
    const router = renderRestore()
    await user.click(
      await screen.findByRole('button', { name: '계정 되살리기' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이미 삭제가 시작되어 되살릴 수 없어요. 새로 가입해 주세요.'
    )
    expect(document.querySelector('.auth-guest-hint')).not.toBeNull()
    await waitFor(() =>
      expect(router.state.location.search).not.toContain('sso=')
    )
  })

  it('복구 증거가 없으면(404) 바로 실패 안내로 간다', async () => {
    mockServer.use(
      http.get('*/api/auth/sso/restore', () =>
        HttpResponse.json(
          { code: 'SSO_ACCOUNT_RESTORE_UNAVAILABLE' },
          { status: 404 }
        )
      )
    )
    renderRestore()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '계정을 되살리지 못했어요. 잠시 뒤 다시 로그인해 주세요.'
    )
  })

  it('[그대로 탈퇴하기]는 비회원 첫 화면으로 가고 예정 날짜를 알린다', async () => {
    let declines = 0
    mockServer.use(
      restoreState(),
      http.post('*/api/auth/sso/restore/decline', () => {
        declines += 1
        return HttpResponse.json(
          { declined: true, deletionScheduledAt: SCHEDULED },
          noStore
        )
      })
    )
    const user = userEvent.setup()
    const router = renderRestore()
    await user.click(
      await screen.findByRole('button', { name: '그대로 탈퇴하기' })
    )
    expect(await screen.findByText('홈 도착')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(declines).toBe(1)
    expect(
      await screen.findByText(/^\d+월 \d+일 .+시에 예정대로 삭제돼요\.$/u)
    ).toBeInTheDocument()
    expect(mockDatabase.getCurrentUser()).toBeNull()
  })

  it('JA 문구', async () => {
    // I18nProvider reads the saved choice, like a returning visitor.
    window.localStorage.setItem(
      'harumaru:ui-locale:v1',
      JSON.stringify({ locale: 'ja', version: 1 })
    )
    mockServer.use(restoreState())
    renderRestore()
    expect(
      await screen.findByRole('heading', {
        name: '退会を申し込んだアカウントです'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'アカウントを元に戻す' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'このまま退会する' })
    ).toBeInTheDocument()
  })
})

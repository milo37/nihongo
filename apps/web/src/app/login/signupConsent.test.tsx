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

const noStore = { headers: { 'Cache-Control': 'private, no-store' } }
const reads = { count: 0 }
const pending = (
  kind: 'NEW' | 'EXISTING' = 'NEW',
  nicknameDefault = '데모 학습자'
) =>
  http.get('*/api/auth/sso/signup-consent', () => {
    reads.count += 1
    return HttpResponse.json(
      {
        kind,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        redirect: '/wrong-notes',
        nicknameDefault
      },
      noStore
    )
  })

const renderConsent = (
  entry = '/login?sso=CONSENT_REQUIRED&redirect=%2Fwrong-notes'
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

describe('#1085 가입 확인', () => {
  beforeAll(async () => {
    await import('@app/login/page')
  })
  beforeEach(async () => {
    reads.count = 0
    window.localStorage.removeItem('harumaru:ui-locale:v1')
    await appI18n.changeLanguage('ko')
    mockDatabase.logout()
    queryClient.clear()
  })

  it('제목에 초점, 필수 두 칸, [가입하기]·[취소], 약관은 새 탭', async () => {
    mockServer.use(pending())
    const router = renderConsent()
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: '가입하려면 아래 항목을 확인해 주세요.'
    })
    expect(heading).toHaveFocus()
    const nickname = screen.getByRole('textbox', { name: '닉네임' })
    expect(nickname).toHaveValue('데모 학습자')
    expect(nickname).toHaveAccessibleDescription('2~12자로 정해 주세요.')
    const age = screen.getByRole('checkbox', {
      name: '만\u00a014세 이상이에요'
    })
    expect(age).not.toBeChecked()
    expect(age).toHaveAccessibleDescription(
      '만\u00a014세 미만은 로그인 없이 문제를 풀 수 있어요.'
    )
    expect(
      screen.getByRole('checkbox', {
        name: /^이용약관\s?과 개인정보 처리방침\s?을 확인했어요$/u
      })
    ).not.toBeChecked()
    expect(screen.getByRole('link', { name: '이용약관' })).toHaveAttribute(
      'target',
      '_blank'
    )
    expect(screen.getByRole('button', { name: '가입하기' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '취소' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Google로 계속하기' })
    ).not.toBeInTheDocument()
    expect(router.state.location.search).toContain('sso=CONSENT_REQUIRED')
  })

  it('기존 회원은 제목과 버튼만 다르다', async () => {
    mockServer.use(pending('EXISTING'))
    renderConsent()
    expect(
      await screen.findByRole('heading', {
        name: '계속 쓰시려면 아래 항목을 확인해 주세요.'
      })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '확인' })).toBeEnabled()
  })

  it('빈 칸이 있으면 보내지 않고 알린 뒤 첫 빈 칸으로 간다', async () => {
    let posts = 0
    mockServer.use(
      pending(),
      http.post('*/api/auth/sso/signup-consent', () => {
        posts += 1
        return HttpResponse.json({ signedIn: true, redirect: '/' })
      })
    )
    const user = userEvent.setup()
    renderConsent()
    const terms = await screen.findByRole('checkbox', {
      name: /^이용약관\s?과 개인정보 처리방침\s?을 확인했어요$/u
    })
    await user.click(
      screen.getByRole('checkbox', { name: '만\u00a014세 이상이에요' })
    )
    await user.click(screen.getByRole('button', { name: '가입하기' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '필수 항목을 확인해 주세요'
    )
    expect(terms).toHaveFocus()
    expect(posts).toBe(0)
  })

  it('닉네임이 비면 체크 오류와 함께 알리고 닉네임으로 간다', async () => {
    let posts = 0
    mockServer.use(
      pending('NEW', ''),
      http.post('*/api/auth/sso/signup-consent', () => {
        posts += 1
        return HttpResponse.json({ signedIn: true, redirect: '/' })
      })
    )
    const user = userEvent.setup()
    renderConsent()
    const nickname = await screen.findByRole('textbox', { name: '닉네임' })
    expect(nickname).toHaveValue('')
    await user.type(nickname, ' 데 ')
    expect(nickname).not.toHaveAttribute('aria-invalid')
    await user.click(screen.getByRole('button', { name: '가입하기' }))
    expect(nickname).toHaveAttribute('aria-invalid', 'true')
    expect(nickname).toHaveAccessibleDescription(
      '닉네임을 2자 이상 입력해 주세요'
    )
    expect(screen.getByText('필수 항목을 확인해 주세요')).toBeInTheDocument()
    expect(nickname).toHaveFocus()
    expect(posts).toBe(0)
    await user.type(nickname, '모')
    expect(nickname).not.toHaveAttribute('aria-invalid')
    expect(nickname).toHaveAccessibleDescription('2~12자로 정해 주세요.')
  })

  it('13번째 글자는 들어가지 않는다(글자는 코드 포인트로 센다)', async () => {
    mockServer.use(pending('NEW', ''))
    const user = userEvent.setup()
    renderConsent()
    const nickname = await screen.findByRole('textbox', { name: '닉네임' })
    await user.click(nickname)
    await user.paste('가나다라마바사아자차카타파하')
    expect(nickname).toHaveValue('가나다라마바사아자차카타')
    await user.clear(nickname)
    await user.paste('😀'.repeat(13))
    expect(nickname).toHaveValue('😀'.repeat(12))
    expect(nickname).not.toHaveAttribute('aria-invalid')
  })

  it('서버가 닉네임을 거절하면 같은 자리에 알린다', async () => {
    mockServer.use(
      pending(),
      http.post('*/api/auth/sso/signup-consent', () =>
        HttpResponse.json(
          { code: 'SIGNUP_NICKNAME_INVALID', message: 'invalid' },
          { status: 400 }
        )
      )
    )
    const user = userEvent.setup()
    const router = renderConsent()
    await user.click(
      await screen.findByRole('checkbox', { name: '만\u00a014세 이상이에요' })
    )
    await user.click(
      screen.getByRole('checkbox', {
        name: /^이용약관\s?과 개인정보 처리방침\s?을 확인했어요$/u
      })
    )
    await user.click(screen.getByRole('button', { name: '가입하기' }))
    const nickname = screen.getByRole('textbox', { name: '닉네임' })
    await waitFor(() =>
      expect(nickname).toHaveAttribute('aria-invalid', 'true')
    )
    expect(nickname).toHaveFocus()
    expect(router.state.location.search).toContain('sso=CONSENT_REQUIRED')
    expect(screen.getByRole('button', { name: '가입하기' })).toBeEnabled()
  })

  it('둘 다 체크하면 한 번만 보내고 회원으로 원래 경로에 간다', async () => {
    const bodies: unknown[] = []
    mockServer.use(
      pending(),
      http.post('*/api/auth/sso/signup-consent', async ({ request }) => {
        bodies.push(await request.json())
        mockDatabase.loginAs('USER')
        return HttpResponse.json(
          { signedIn: true, redirect: '/wrong-notes' },
          noStore
        )
      })
    )
    const user = userEvent.setup()
    const router = renderConsent()
    await user.click(
      await screen.findByRole('checkbox', {
        name: '만\u00a014세 이상이에요'
      })
    )
    await user.click(
      screen.getByRole('checkbox', {
        name: /^이용약관\s?과 개인정보 처리방침\s?을 확인했어요$/u
      })
    )
    await user.dblClick(screen.getByRole('button', { name: '가입하기' }))
    expect(await screen.findByText('오답노트 도착')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/wrong-notes')
    expect(bodies).toEqual([
      { nickname: '데모 학습자', ageConfirmed: true, termsConfirmed: true }
    ])
    // The spent pending sign-up is not read again (it would be a 404).
    expect(reads.count).toBe(1)
  })

  it('[취소]는 대기를 버리고 비회원으로 원래 경로에 가서 알린다', async () => {
    let cancels = 0
    mockServer.use(
      pending(),
      http.post('*/api/auth/sso/signup-consent/cancel', () => {
        cancels += 1
        return HttpResponse.json({ cancelled: true })
      })
    )
    const user = userEvent.setup()
    renderConsent()
    await user.click(await screen.findByRole('button', { name: '취소' }))
    expect(await screen.findByText('오답노트 도착')).toBeInTheDocument()
    expect(
      await screen.findByText(
        '가입하지 않았어요. 로그인 없이 계속 풀 수 있어요.'
      )
    ).toBeInTheDocument()
    await waitFor(() => expect(cancels).toBe(1))
    expect(reads.count).toBe(1)
  })

  it('대기 시간이 지났으면 로그인 화면에 알린다', async () => {
    mockServer.use(
      http.get('*/api/auth/sso/signup-consent', () =>
        HttpResponse.json({ code: 'SIGNUP_PENDING_EXPIRED' }, { status: 404 })
      )
    )
    const router = renderConsent()
    expect(
      await screen.findByText('시간이 지났어요. 다시 로그인해 주세요.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Google로 계속하기' })
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(router.state.location.search).not.toContain('sso=')
    )
  })

  it('[가입하기] 때 시간이 지났으면 로그인 화면으로 돌아간다', async () => {
    mockServer.use(
      pending(),
      http.post('*/api/auth/sso/signup-consent', () =>
        HttpResponse.json({ code: 'SIGNUP_PENDING_EXPIRED' }, { status: 404 })
      )
    )
    const user = userEvent.setup()
    renderConsent()
    await user.click(
      await screen.findByRole('checkbox', {
        name: '만\u00a014세 이상이에요'
      })
    )
    await user.click(
      screen.getByRole('checkbox', {
        name: /^이용약관\s?과 개인정보 처리방침\s?을 확인했어요$/u
      })
    )
    await user.click(screen.getByRole('button', { name: '가입하기' }))
    expect(
      await screen.findByText('시간이 지났어요. 다시 로그인해 주세요.')
    ).toBeInTheDocument()
  })
})

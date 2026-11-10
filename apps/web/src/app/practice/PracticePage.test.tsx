import { QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { PracticePage } from '@app/practice/page'
import { mockServer } from '@/test/server'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockGuestAllowance } from '@mocks/handlers/guestAllowanceHandlers'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { AuthErrorHandlerProvider } from '@nihongo/browser/provider/AuthErrorHandlerProvider'

const renderPractice = (search: string, { globalErrors = false } = {}) => {
  const router = createMemoryRouter(
    [
      {
        path: '/practice',
        element: (
          <ProtectedRouteProvider>
            {globalErrors ? <AuthErrorHandlerProvider /> : null}
            <PracticePage />
          </ProtectedRouteProvider>
        )
      },
      {
        path: '/practice/session/:sessionId',
        element: <h1>학습 세션 도착</h1>
      },
      { path: '/forbidden', element: <h1>접근 금지 도착</h1> }
    ],
    { initialEntries: [`/practice${search}`] }
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
  return router
}

describe('PracticePage setup', () => {
  it('게스트의 기본값은 N5 어휘이고 문제 수는 게스트 한도 10문제다', async () => {
    renderPractice('')
    expect(
      await screen.findByRole('button', { name: 'N5 문자·어휘 10문제 시작' })
    ).toBeInTheDocument()
  })

  it('로그인 사용자의 기본 급수는 목표 급수이고 URL 값이 우선한다', async () => {
    const user = mockDatabase.loginAs('USER')
    expect(user.targetLevel).toBe('N2')
    renderPractice('')
    expect(
      await screen.findByRole('button', { name: 'N2 문자·어휘 10문제 시작' })
    ).toBeInTheDocument()

    cleanup()
    renderPractice('?level=N4&subject=READING&count=5')
    // A member always gets one set of 10; the old count link is ignored.
    expect(
      await screen.findByRole('button', { name: 'N4 독해 10문제 시작' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '문제 수' })).toBeNull()
  })

  it('목표 급수가 없으면 이 기기에서 마지막에 시작한 급수·과목을 기본으로 쓴다', async () => {
    const router = renderPractice('?level=N3&subject=GRAMMAR')
    const start = await screen.findByRole('button', {
      name: 'N3 문법 10문제 시작'
    })
    await waitFor(() => expect(start).toBeEnabled())
    await userEvent.setup().click(start)
    expect(await screen.findByText('학습 세션 도착')).toBeInTheDocument()
    expect(router.state.location.pathname).toMatch(/^\/practice\/session\//u)

    cleanup()
    renderPractice('')
    expect(
      await screen.findByRole('button', { name: 'N3 문법 10문제 시작' })
    ).toBeInTheDocument()

    // A target level still wins over the last level; the subject stays.
    cleanup()
    mockDatabase.loginAs('USER')
    renderPractice('')
    expect(
      await screen.findByRole('button', { name: 'N2 문법 10문제 시작' })
    ).toBeInTheDocument()
  })

  it('사용자 정보가 늦게 오면 기본 급수를 기다렸다가 한 번만 정한다', async () => {
    let releaseMe = (): void => undefined
    const meGate = new Promise<void>((resolve) => {
      releaseMe = resolve
    })
    // Hold /me, then fall through to the normal mock answer.
    mockServer.use(
      http.get('*/api/v1/me', async () => {
        await meGate
        return undefined
      })
    )
    mockDatabase.loginAs('USER')
    renderPractice('')
    const level = await screen.findByRole('group', { name: '급수' })
    const start = screen.getByRole('button', { name: '불러오는 중…' })
    expect(start).toBeDisabled()
    expect(within(level).queryByRole('radio', { checked: true })).toBeNull()
    expect(screen.queryByText(/N5 어휘/)).not.toBeInTheDocument()

    releaseMe()
    expect(
      await screen.findByRole('button', { name: 'N2 문자·어휘 10문제 시작' })
    ).toBeEnabled()
    expect(
      within(level).getByRole('radio', { checked: true })
    ).toHaveAccessibleName('N2')
  })

  it('URL에 급수가 있으면 사용자 정보를 기다리지 않고 그 급수를 보여 준다', async () => {
    mockServer.use(http.get('*/api/v1/me', () => new Promise<never>(() => {})))
    mockDatabase.loginAs('USER')
    renderPractice('?level=N4')
    const level = await screen.findByRole('group', { name: '급수' })
    expect(
      within(level).getByRole('radio', { checked: true })
    ).toHaveAccessibleName('N4')
  })

  it('선택한 조건으로 세션을 만들고 학습 화면으로 이동한다', async () => {
    const router = renderPractice('?level=N5&subject=VOCABULARY&count=5')
    const start = await screen.findByRole('button', {
      name: 'N5 문자·어휘 10문제 시작'
    })
    await waitFor(() => expect(start).toBeEnabled())
    await userEvent.setup().click(start)
    expect(await screen.findByText('학습 세션 도착')).toBeInTheDocument()
    expect(router.state.location.pathname).toMatch(/^\/practice\/session\//u)
  })

  it('게스트가 공유 주소로 잠긴 방식을 열면 10문제·무작위로 보여 주고 안내한다 (L12)', async () => {
    const search = '?level=N5&subject=VOCABULARY&count=20&mode=DAILY_REVIEW'
    renderPractice(search)
    const note = await screen.findByText(
      '문제 수와 출제 방식은 로그인하면 고를 수 있어요.'
    )
    const box = note.closest('[role="status"]') as HTMLElement
    expect(within(box).getByRole('link', { name: '로그인' })).toHaveAttribute(
      'href',
      `/login?redirect=${encodeURIComponent(`/practice${search}`)}`
    )
    const start = screen.getByRole('button', {
      name: 'N5 문자·어휘 10문제 시작'
    })
    await waitFor(() => expect(start).toBeEnabled())
    // Guests have no mode picker: the review set needs wrong notes.
    expect(
      screen.queryByRole('combobox', { name: '출제 방식', hidden: true })
    ).toBeNull()
  })

  it('게스트에게는 잠긴 선택지가 없다: 출제 방식 칸도 문제 수 칸도 없다 (JLP-823)', async () => {
    renderPractice('?level=N5&subject=VOCABULARY')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'N5 문자·어휘 10문제 시작' })
      ).toBeEnabled()
    )
    expect(screen.queryByRole('group', { name: '문제 수' })).toBeNull()
    expect(
      screen.queryByRole('combobox', { name: '출제 방식', hidden: true })
    ).toBeNull()
    expect(screen.queryByText(/로그인하면 사용/u)).toBeNull()
  })

  it('게스트가 한 번이라도 풀면 남은 횟수를 보이고, 0회면 시작 대신 한도 카드를 둔다 (JLP-823)', async () => {
    mockGuestAllowance.setRemaining(1)
    const first = renderPractice('?level=N5&subject=VOCABULARY')
    expect(await screen.findByText('오늘 1번 더 풀 수 있어요')).toBeVisible()
    expect(
      screen.getByText(
        /^로그인 없이 하루 3번, 한 번에 10문제씩 풀 수 있어요\./u
      )
    ).toBeVisible()
    first.dispose()
    cleanup()
    queryClient.clear()

    mockGuestAllowance.setRemaining(0)
    renderPractice('?level=N5&subject=VOCABULARY')
    const card = (
      await screen.findByRole('heading', { name: '오늘 3번을 다 풀었어요' })
    ).closest('section') as HTMLElement
    expect(
      within(card).getByText(
        '로그인하면 계속 풀고, 틀린 문제도 모아 둘 수 있어요.'
      )
    ).toBeVisible()
    expect(
      within(card).getByRole('button', { name: 'Google로 로그인' })
    ).toBeEnabled()
    expect(within(card).getByText('내일 0시에 다시 3번')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /문제 시작/u })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'N5' })).toBeChecked()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('서버가 하루 상한으로 거절하면 같은 카드를 보이고 금지 화면으로 가지 않는다', async () => {
    mockGuestAllowance.enforce()
    mockGuestAllowance.setRemaining(1)
    mockServer.use(
      http.post('*/api/v1/study-sessions', () => {
        // Another tab used the last try meanwhile.
        mockGuestAllowance.setRemaining(0)
        return HttpResponse.json(
          {
            code: 'GUEST_LIMIT_REACHED',
            message: 'synthetic',
            details: { resetsAt: mockGuestAllowance.resetsAt() },
            requestId: crypto.randomUUID(),
            retryable: false
          },
          { status: 403 }
        )
      })
    )
    const router = renderPractice('?level=N5&subject=VOCABULARY', {
      globalErrors: true
    })
    const start = await screen.findByRole('button', {
      name: 'N5 문자·어휘 10문제 시작'
    })
    await waitFor(() => expect(start).toBeEnabled())
    await userEvent.setup().click(start)
    expect(
      await screen.findByRole('heading', { name: '오늘 3번을 다 풀었어요' })
    ).toBeVisible()
    expect(router.state.location.pathname).toBe('/practice')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('거절에 실린 초기화 시각이 지나면 카드를 걷고 시작 버튼을 돌려준다', async () => {
    mockGuestAllowance.enforce()
    mockGuestAllowance.setRemaining(1)
    const resetsAt = new Date(Date.now() + 1_500).toISOString()
    mockServer.use(
      http.post('*/api/v1/study-sessions', () =>
        HttpResponse.json(
          {
            code: 'GUEST_LIMIT_REACHED',
            message: 'synthetic',
            details: { resetsAt },
            requestId: crypto.randomUUID(),
            retryable: false
          },
          { status: 403 }
        )
      )
    )
    renderPractice('?level=N5&subject=VOCABULARY', { globalErrors: true })
    const name = 'N5 문자·어휘 10문제 시작'
    const start = await screen.findByRole('button', { name })
    await waitFor(() => expect(start).toBeEnabled())
    await userEvent.setup().click(start)
    expect(
      await screen.findByRole('heading', { name: '오늘 3번을 다 풀었어요' })
    ).toBeVisible()
    await waitFor(
      () =>
        expect(
          screen.queryByRole('heading', { name: '오늘 3번을 다 풀었어요' })
        ).not.toBeInTheDocument(),
      { timeout: 4_000 }
    )
    expect(await screen.findByRole('button', { name })).toBeEnabled()
  })

  it('기본값으로 시작했는데 공개된 문제가 없으면 그 조건 그대로 안내한다', async () => {
    let requested: unknown
    mockServer.use(
      http.post('*/api/v1/study-sessions', async ({ request }) => {
        requested = await request.json()
        return HttpResponse.json(
          {
            code: 'NO_ELIGIBLE_QUESTIONS',
            message: 'synthetic',
            requestId: crypto.randomUUID()
          },
          { status: 422 }
        )
      })
    )
    mockDatabase.loginAs('USER')
    renderPractice('')
    const user = userEvent.setup()
    const start = await screen.findByRole('button', {
      name: 'N2 문자·어휘 10문제 시작'
    })
    await waitFor(() => expect(start).toBeEnabled())
    await user.click(start)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "지금 조건으로는 '랜덤'에서 풀 수 있는 문제가 없어요."
    )
    expect(requested).toMatchObject({
      level: 'N2',
      subject: 'VOCABULARY',
      count: 10,
      mode: 'RANDOM'
    })
    // Already RANDOM: there is no other mode to offer.
    expect(
      screen.queryByRole('button', { name: '랜덤으로 바꾸기' })
    ).not.toBeInTheDocument()
  })

  it('출제 가능한 문제가 없으면 안내 후 랜덤 모드로 바꿀 수 있다', async () => {
    mockServer.use(
      http.post('*/api/v1/study-sessions', () =>
        HttpResponse.json(
          {
            code: 'NO_ELIGIBLE_QUESTIONS',
            message: 'synthetic',
            requestId: crypto.randomUUID()
          },
          { status: 422 }
        )
      )
    )
    mockDatabase.loginAs('USER')
    const router = renderPractice(
      '?level=N5&subject=VOCABULARY&mode=DAILY_REVIEW'
    )
    const user = userEvent.setup()
    const start = await screen.findByRole('button', {
      name: 'N5 문자·어휘 10문제 시작'
    })
    await waitFor(() => expect(start).toBeEnabled())
    await user.click(start)
    expect(
      await screen.findByText(
        '복습할 문제가 없어요. 다른 방식으로 풀어 보세요.'
      )
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '랜덤으로 바꾸기' }))
    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get('mode')
      ).toBeNull()
    )
    expect(
      screen.queryByText('복습할 문제가 없어요. 다른 방식으로 풀어 보세요.')
    ).not.toBeInTheDocument()
  })

  it('이용이 제한된 계정이면 일반 오류 대신 제한 안내를 보여 준다', async () => {
    const restricted = mockDatabase.loginAs('USER')
    mockDatabase.setAccountRestricted(restricted.id, true)
    const router = renderPractice('?level=N5&subject=VOCABULARY', {
      globalErrors: true
    })
    const start = await screen.findByRole('button', {
      name: 'N5 문자·어휘 10문제 시작'
    })
    await waitFor(() => expect(start).toBeEnabled())
    await userEvent.setup().click(start)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '지금은 이용이 잠시 제한된 계정이에요. 제한이 풀리면 다시 학습하고 신고할 수 있어요.'
    )
    expect(screen.queryByText('처리하지 못했어요')).toBeNull()
    // The global 403 handler must keep the restricted member on this screen.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(router.state.location.pathname).toBe('/practice')
    expect(screen.queryByText('접근 금지 도착')).toBeNull()
  })
})

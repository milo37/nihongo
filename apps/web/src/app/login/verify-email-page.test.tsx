import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { StrictMode } from 'react'
import { VerifyEmailPage } from '@app/login/verify-email-page'
import { queryClient } from '@libs/queryClient'
import { mockServer } from '@/test/server'

const renderPage = (): void => {
  const router = createMemoryRouter(
    [
      {
        path: '/verify-email',
        element: <VerifyEmailPage />
      },
      {
        path: '/login',
        element: <p>로그인 도착</p>
      }
    ],
    { initialEntries: ['/verify-email'] }
  )

  render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>
  )
}

describe('VerifyEmailPage', () => {
  it('fragment token을 즉시 주소에서 제거하고 명시적 확인 뒤에만 POST한다', async () => {
    const user = userEvent.setup()
    const token = 'private-verification-token'
    let requestBody: unknown
    let requestCount = 0
    mockServer.use(
      http.post('*/api/auth/verify-email', async ({ request }) => {
        requestCount += 1
        requestBody = await request.json()
        return HttpResponse.json({ success: true as const })
      })
    )
    window.history.replaceState(
      {},
      '',
      `/verify-email#token=${encodeURIComponent(token)}`
    )

    renderPage()

    expect(window.location.hash).toBe('')
    expect(requestCount).toBe(0)
    expect(document.body).not.toHaveTextContent(token)

    await user.click(screen.getByRole('button', { name: '이메일 인증하기' }))

    const heading = await screen.findByRole('heading', {
      name: '이메일 인증을 완료했습니다'
    })
    expect(requestCount).toBe(1)
    expect(requestBody).toEqual({ token })
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(heading).toHaveFocus())
  })

  it('fragment token이 없으면 서버 요청 없이 새 인증 메일을 안내한다', () => {
    window.history.replaceState({}, '', '/verify-email')

    renderPage()

    expect(
      screen.getByRole('heading', {
        name: '유효하지 않은 이메일 인증 링크'
      })
    ).toHaveFocus()
    expect(
      screen.queryByRole('button', { name: '이메일 인증하기' })
    ).not.toBeInTheDocument()
  })

  it('Mock 미지원 응답을 만료 링크로 오표시하지 않는다', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/verify-email#token=mock-token')

    renderPage()
    await user.click(screen.getByRole('button', { name: '이메일 인증하기' }))

    expect(
      await screen.findByText(
        /Mock 모드에서는 이메일 인증을 지원하지 않습니다/u
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/링크가 만료/u)).not.toBeInTheDocument()
  })
})

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { PracticePage } from '@app/practice/page'
import { mockServer } from '@/test/server'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'

const renderPractice = (search: string) => {
  const router = createMemoryRouter(
    [
      {
        path: '/practice',
        element: (
          <ProtectedRouteProvider>
            <PracticePage />
          </ProtectedRouteProvider>
        )
      },
      {
        path: '/practice/session/:sessionId',
        element: <h1>학습 세션 도착</h1>
      }
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
  it('선택한 조건으로 세션을 만들고 학습 화면으로 이동한다', async () => {
    const router = renderPractice('?level=N5&subject=VOCABULARY&count=5')
    const start = await screen.findByRole('button', {
      name: 'N5 어휘 · 5문제 시작'
    })
    await waitFor(() => expect(start).toBeEnabled())
    await userEvent.setup().click(start)
    expect(await screen.findByText('학습 세션 도착')).toBeInTheDocument()
    expect(router.state.location.pathname).toMatch(/^\/practice\/session\//u)
  })

  it('게스트가 로그인 전용 모드를 고르면 시작을 막고 로그인으로 안내한다', async () => {
    renderPractice('?level=N5&subject=VOCABULARY&mode=BOOKMARK')
    const alert = await screen.findByText(
      /선택한 모드는 로그인 후 이용할 수 있습니다\./u
    )
    expect(
      within(alert.closest('[role="alert"]') as HTMLElement).getByRole('link', {
        name: '로그인하기'
      })
    ).toHaveAttribute(
      'href',
      `/login?redirect=${encodeURIComponent('/practice?level=N5&subject=VOCABULARY&mode=BOOKMARK')}`
    )
    expect(
      screen.getByRole('button', { name: /N5 어휘 · 10문제 시작/u })
    ).toBeDisabled()
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
    const router = renderPractice('?level=N5&subject=VOCABULARY&mode=WEAKNESS')
    const user = userEvent.setup()
    const start = await screen.findByRole('button', {
      name: 'N5 어휘 · 10문제 시작'
    })
    await waitFor(() => expect(start).toBeEnabled())
    await user.click(start)
    expect(
      await screen.findByText(
        '현재 조건에는 출제 가능한 약점 추천 문제가 없습니다.'
      )
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '랜덤 문제 선택' }))
    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get('mode')
      ).toBeNull()
    )
    expect(
      screen.queryByText('현재 조건에는 출제 가능한 약점 추천 문제가 없습니다.')
    ).not.toBeInTheDocument()
  })
})

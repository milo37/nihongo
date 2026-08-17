import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { DashboardPage } from '@app/dashboard/page'
import { queryClient } from '@libs/queryClient'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

describe('DashboardPage', () => {
  it('재시도 성공 후 화면 제목으로 포커스를 복원한다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const stats = mockDatabase.getDashboardStats(currentUser.id)
    let requestCount = 0
    mockServer.use(
      http.get('*/api/dashboard/stats', () => {
        requestCount += 1
        return requestCount <= 2
          ? HttpResponse.json({ message: 'temporary error' }, { status: 500 })
          : HttpResponse.json(stats)
      })
    )
    const router = createMemoryRouter(
      [
        {
          path: '/dashboard',
          element: (
            <ProtectedRouteProvider>
              <DashboardPage />
            </ProtectedRouteProvider>
          )
        }
      ],
      { initialEntries: ['/dashboard'] }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    await screen.findByRole(
      'heading',
      { name: '대시보드를 불러오지 못했습니다' },
      { timeout: 3000 }
    )
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    const heading = await screen.findByRole('heading', {
      name: '학습 흐름을 확인하세요'
    })
    await vi.waitFor(() => expect(heading).toHaveFocus())
  })
})

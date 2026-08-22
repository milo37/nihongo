import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { getDashboardStatsQuerySchema } from '@nihongo/contracts/dashboard/get-dashboard-stats'
import { DashboardPage } from '@app/dashboard/page'
import { queryClient } from '@libs/queryClient'
import { toContractDashboardStats } from '@mocks/adapters/dashboardContractAdapter'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { ProtectedRouteProvider } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

describe('DashboardPage', () => {
  it('재시도 성공 후 화면 제목으로 포커스를 복원한다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const stats = toContractDashboardStats(
      mockDatabase.getCanonicalDashboardRecord(currentUser.id),
      getDashboardStatsQuerySchema.parse({})
    )
    let requestCount = 0
    mockServer.use(
      http.get('*/api/v1/dashboard', () => {
        requestCount += 1
        return requestCount <= 2
          ? HttpResponse.json(
              {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'temporary error',
                requestId: crypto.randomUUID(),
                retryable: true
              },
              { status: 500 }
            )
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

  it('반복 오답에서 복습 센터와 안전한 대시보드 복귀 상세 링크를 제공한다', async () => {
    const currentUser = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(currentUser)
    const questionId = '018f6b7a-1f4b-7d5e-8a91-0000000000d1'
    const baseStats = toContractDashboardStats(
      mockDatabase.getCanonicalDashboardRecord(currentUser.id),
      getDashboardStatsQuerySchema.parse({})
    )
    mockServer.use(
      http.get('*/api/v1/dashboard', () =>
        HttpResponse.json({
          ...baseStats,
          totalAnsweredCount: 1,
          correctCount: 0,
          correctRate: 0,
          wrongNoteCount: Math.max(baseStats.wrongNoteCount, 1),
          subjectStats: baseStats.subjectStats.map((subject) =>
            subject.subject === 'VOCABULARY'
              ? {
                  ...subject,
                  answeredCount: 1,
                  correctCount: 0,
                  correctRate: 0
                }
              : subject
          ),
          repeatedWrongQuestions: [
            {
              questionId,
              questionPreview: '대시보드 링크 확인용 오답',
              level: 'N5',
              subject: 'VOCABULARY',
              wrongCount: 2,
              status: 'AGAIN'
            }
          ]
        })
      )
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

    expect(
      await screen.findByRole('link', { name: '복습 센터에서 보기' })
    ).toHaveAttribute('href', '/wrong-notes?view=REPEATED&sort=MOST_WRONG')
    expect(
      screen.getByRole('link', { name: '대시보드 링크 확인용 오답' })
    ).toHaveAttribute(
      'href',
      `/wrong-notes/${questionId}?returnTo=%2Fdashboard`
    )
  })
})

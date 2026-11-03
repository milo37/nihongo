import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { DashboardRecommendedEntry } from '@app/dashboard/components/LearningEntry'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ProtectedRouteProvider } from '@nihongo/browser/provider/ProtectedRouteProvider'

it('이용이 제한된 계정이 추천 학습을 시작하면 제한 안내를 보여 준다', async () => {
  const restricted = mockDatabase.loginAs('USER')
  mockDatabase.setAccountRestricted(restricted.id, true)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  const router = createMemoryRouter(
    [
      {
        path: '/dashboard',
        element: (
          <ProtectedRouteProvider>
            <DashboardRecommendedEntry onReady={() => undefined} />
          </ProtectedRouteProvider>
        )
      }
    ],
    { initialEntries: ['/dashboard'] }
  )
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  )
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: '일반 연습 시작하기' }))
  expect(
    await screen.findByText(
      '임시로 이용이 제한된 계정입니다. 새 학습과 신고는 제한이 풀린 뒤 이용할 수 있습니다.'
    )
  ).toBeVisible()
  expect(
    screen.queryByText(/추천 학습을 시작하지 못했습니다/u)
  ).not.toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/dashboard')
  client.clear()
})

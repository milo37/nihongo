import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { WrongNotePage } from '@app/wrong-note/page'
import { queryClient } from '@libs/queryClient'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'

describe('WrongNotePage', () => {
  it('저장된 오답이 없으면 빈 상태와 첫 학습 CTA를 표시한다', async () => {
    mockDatabase.loginAs('USER')
    const router = createMemoryRouter(
      [
        {
          path: '/wrong-notes',
          element: <WrongNotePage />
        }
      ],
      { initialEntries: ['/wrong-notes'] }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    expect(
      await screen.findByRole('heading', {
        name: '아직 조건에 맞는 오답이 없습니다'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText('문제를 풀고 틀린 항목은 자동으로 이곳에 저장됩니다.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '첫 문제 풀기' })).toHaveAttribute(
      'href',
      '/practice'
    )
  })

  it('재시도 성공 후 화면 제목으로 포커스를 복원한다', async () => {
    const user = userEvent.setup()
    mockDatabase.loginAs('USER')
    let requestCount = 0
    mockServer.use(
      http.get('*/api/wrong-note', () => {
        requestCount += 1
        return requestCount <= 2
          ? HttpResponse.json({ message: 'temporary error' }, { status: 500 })
          : HttpResponse.json({
              items: [],
              total: 0,
              page: 1,
              pageSize: 12,
              availableTags: []
            })
      })
    )
    const router = createMemoryRouter(
      [{ path: '/wrong-notes', element: <WrongNotePage /> }],
      { initialEntries: ['/wrong-notes'] }
    )

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    await screen.findByRole(
      'heading',
      { name: '오답노트를 불러오지 못했습니다' },
      { timeout: 3000 }
    )
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    const heading = await screen.findByRole('heading', {
      name: '오답을 해결 상태까지 관리하세요'
    })
    await vi.waitFor(() => expect(heading).toHaveFocus())
  })
})

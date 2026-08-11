import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { render, screen } from '@testing-library/react'
import { WrongNotePage } from '@app/wrong-note/page'
import { queryClient } from '@libs/queryClient'
import { mockDatabase } from '@mocks/repository/mockDatabase'

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
})

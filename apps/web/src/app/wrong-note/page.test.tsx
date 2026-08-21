import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { listWrongNotesQuerySchema } from '@nihongo/contracts/wrong-note/list-wrong-notes'
import { WrongNotePage } from '@app/wrong-note/page'
import { queryClient } from '@libs/queryClient'
import { toContractWrongNoteList } from '@mocks/adapters/wrongNoteReadContractAdapter'
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
      http.get('*/api/v1/wrong-notes', () => {
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
          : HttpResponse.json(
              toContractWrongNoteList(
                [],
                listWrongNotesQuerySchema.parse({ page: 1, pageSize: 12 })
              )
            )
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

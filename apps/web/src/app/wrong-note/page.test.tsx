import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach } from 'vitest'
import { listWrongNotesQuerySchema } from '@nihongo/contracts/wrong-note/list-wrong-notes'
import { createStudySessionV1 } from '@api/study/createStudySessionV1'
import { submitStudySessionV1 } from '@api/study/submitStudySessionV1'
import { WrongNotePage } from '@app/wrong-note/page'
import { queryClient } from '@libs/queryClient'
import { toContractWrongNoteList } from '@mocks/adapters/wrongNoteReadContractAdapter'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { mockServer } from '@/test/server'

describe('WrongNotePage', () => {
  afterEach(() => {
    onlineManager.setOnline(true)
  })

  it('오프라인 direct entry에서 loading spinner 대신 복구 상태를 표시한다', async () => {
    onlineManager.setOnline(false)
    mockDatabase.loginAs('USER')
    const router = createMemoryRouter(
      [{ path: '/wrong-notes/history', element: <WrongNotePage /> }],
      { initialEntries: ['/wrong-notes/history'] }
    )
    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    expect(
      await screen.findByText(/전체 오답 기록을 자동으로 다시 불러옵니다/u)
    ).toBeInTheDocument()
    expect(
      screen.queryByText('오답노트를 불러오고 있습니다.')
    ).not.toBeInTheDocument()
    rendered.unmount()
    queryClient.clear()
  })

  it('저장된 오답이 없으면 빈 상태와 첫 학습 CTA를 표시한다', async () => {
    mockDatabase.loginAs('USER')
    const router = createMemoryRouter(
      [
        {
          path: '/wrong-notes/history',
          element: <WrongNotePage />
        }
      ],
      {
        initialEntries: [
          '/wrong-notes/history?tag=%EC%97%86%EB%8A%94%ED%83%9C%EA%B7%B8'
        ]
      }
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
    expect(screen.getByRole('combobox', { name: '태그' })).toHaveValue(
      '없는태그'
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
      [{ path: '/wrong-notes/history', element: <WrongNotePage /> }],
      { initialEntries: ['/wrong-notes/history'] }
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
      name: '전체 오답 기록'
    })
    await vi.waitFor(() => expect(heading).toHaveFocus())
  })

  it('background refresh 실패에도 cached 기록을 유지하고 retry 후 제목 포커스를 복원한다', async () => {
    const user = userEvent.setup()
    const currentUser = mockDatabase.loginAs('USER')
    const session = await createStudySessionV1({
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      count: 1
    })
    const question = session.questions[0]
    if (!question) throw new Error('오답 기록 fixture의 문제가 필요합니다.')
    await submitStudySessionV1(
      session.session.id,
      {
        answers: [
          {
            studySessionQuestionId: question.sessionQuestionId,
            selectedOptionId: null,
            elapsedSec: 0
          }
        ],
        durationSec: 0
      },
      crypto.randomUUID()
    )
    const query = listWrongNotesQuerySchema.parse({ page: 1, pageSize: 12 })
    const response = toContractWrongNoteList(
      mockDatabase.listCanonicalWrongNoteRecords(currentUser.id),
      query
    )
    const responseItem = response.items[0]
    if (!responseItem) throw new Error('오답 기록 응답 item이 필요합니다.')
    let requestCount = 0
    mockServer.use(
      http.get('*/api/v1/wrong-notes', () => {
        requestCount += 1
        if (requestCount === 2) {
          return HttpResponse.json(
            {
              code: 'INTERNAL_SERVER_ERROR',
              message: 'temporary history error',
              requestId: crypto.randomUUID(),
              retryable: true
            },
            { status: 500 }
          )
        }
        return HttpResponse.json(response)
      })
    )
    const client = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false }
      }
    })
    const router = createMemoryRouter(
      [{ path: '/wrong-notes/history', element: <WrongNotePage /> }],
      { initialEntries: ['/wrong-notes/history'] }
    )
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    await screen.findByRole('heading', { name: '오답 1개' })

    await act(async () => {
      await client.invalidateQueries()
    })
    expect(
      await screen.findByText(
        /전체 오답 기록의 최신 상태를 확인하지 못했습니다/u
      )
    ).toBeInTheDocument()
    expect(
      await screen.findByText(responseItem.questionPreview)
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: '전체 오답 기록 다시 확인' })
    )
    await vi.waitFor(() =>
      expect(
        screen.queryByText(/전체 오답 기록의 최신 상태를 확인하지 못했습니다/u)
      ).not.toBeInTheDocument()
    )
    await vi.waitFor(() =>
      expect(
        screen.getByRole('heading', { name: '전체 오답 기록' })
      ).toHaveFocus()
    )
    expect(requestCount).toBe(3)
    client.clear()
  })
})

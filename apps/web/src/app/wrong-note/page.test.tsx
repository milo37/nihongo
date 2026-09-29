import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
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

const createDeferred = (): {
  promise: Promise<void>
  release: () => void
} => {
  let release: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release: () => release?.() }
}

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

  it('browser back의 유효한 페이지를 이전 placeholder total로 보정하지 않는다', async () => {
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
    const baseResponse = toContractWrongNoteList(
      mockDatabase.listCanonicalWrongNoteRecords(currentUser.id),
      listWrongNotesQuerySchema.parse({ page: 1, pageSize: 12 })
    )
    const pageTwoGate = createDeferred()
    let pageTwoStarted = false
    mockServer.use(
      http.get('*/api/v1/wrong-notes', async ({ request }) => {
        const page = new URL(request.url).searchParams.get('page')
        if (page === '2') {
          pageTwoStarted = true
          await pageTwoGate.promise
          return HttpResponse.json({ ...baseResponse, page: 2, total: 13 })
        }
        return HttpResponse.json({ ...baseResponse, page: 1, total: 1 })
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
      {
        initialEntries: [
          '/wrong-notes/history?page=2',
          '/wrong-notes/history?status=SOLVED'
        ],
        initialIndex: 1
      }
    )
    const rendered = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    await screen.findByRole('heading', { name: '오답 1개' })

    await act(async () => router.navigate(-1))
    await waitFor(() => expect(pageTwoStarted).toBe(true))
    expect(router.state.location.search).toBe('?page=2')
    expect(
      screen.queryByText('유효한 오답노트 페이지로 이동하고 있습니다…')
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '오답 1개' })).toBeVisible()
    expect(
      screen.getByText('오답노트 페이지를 갱신하고 있습니다…')
    ).toHaveAttribute('role', 'status')
    expect(document.querySelector('ul[aria-busy="true"]')).not.toBeNull()

    await act(async () => pageTwoGate.release())
    expect(
      await screen.findByRole('heading', { name: '오답 13개' })
    ).toBeVisible()
    expect(router.state.location.search).toBe('?page=2')
    expect(
      screen.queryByText('오답노트 페이지를 갱신하고 있습니다…')
    ).not.toBeInTheDocument()
    expect(document.querySelector('ul[aria-busy="true"]')).toBeNull()
    rendered.unmount()
    client.clear()
  })

  it('페이지 전환 중 stale 결과로 포커스하지 않고 새 결과가 확정된 뒤 이동한다', async () => {
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
    const baseResponse = toContractWrongNoteList(
      mockDatabase.listCanonicalWrongNoteRecords(currentUser.id),
      listWrongNotesQuerySchema.parse({ page: 1, pageSize: 12 })
    )
    const pageTwoGate = createDeferred()
    let pageTwoStarted = false
    mockServer.use(
      http.get('*/api/v1/wrong-notes', async ({ request }) => {
        const page = new URL(request.url).searchParams.get('page')
        if (page === '2') {
          pageTwoStarted = true
          await pageTwoGate.promise
          return HttpResponse.json({ ...baseResponse, page: 2, total: 13 })
        }
        return HttpResponse.json({ ...baseResponse, page: 1, total: 13 })
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
    const rendered = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    const resultHeading = await screen.findByRole('heading', {
      name: '오답 13개'
    })

    await user.click(screen.getByRole('link', { name: '2페이지' }))
    await waitFor(() => expect(pageTwoStarted).toBe(true))
    expect(resultHeading).not.toHaveFocus()

    await act(async () => pageTwoGate.release())
    await waitFor(() => expect(resultHeading).toHaveFocus())
    expect(router.state.location.search).toBe('?page=2')
    rendered.unmount()
    client.clear()
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
      await screen.findByRole('heading', {
        level: 3,
        name: responseItem.questionPreview
      })
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

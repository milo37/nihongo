import {
  QueryClient,
  QueryClientProvider,
  onlineManager
} from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listReviewQueueResultSchema } from '@api/wrong-note/listReviewQueue/schema'
import { WrongNoteReviewCenterPage } from '@app/wrong-note/center/page'
import { mockServer } from '@/test/server'

const auth = vi.hoisted(() => ({
  role: 'USER',
  user: { id: 'member', role: 'USER' }
}))
vi.mock('@nihongo/browser/provider/ProtectedRouteProvider', () => ({
  useAuth: () => ({ ...auth, isReady: true })
}))
// The approved baseline has no contracts/testing export; validate a local fixture.
const queue = listReviewQueueResultSchema.parse({
  items: [
    {
      questionId: crypto.randomUUID(),
      currentQuestionVersionId: crypto.randomUUID(),
      level: 'N5',
      subject: 'VOCABULARY',
      questionType: 'KANJI_READING',
      questionPreview: '「川」의 읽는 법은 어느 것입니까.',
      tags: ['한자 읽기'],
      status: 'AGAIN',
      wrongCount: 2,
      correctStreak: 0,
      lastWrongAt: '2026-08-21T02:00:00.000Z',
      lastReviewedAt: '2026-08-21T02:00:00.000Z',
      nextReviewAt: '2026-08-22T02:00:00.000Z',
      hasMemo: true
    }
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  counts: { due: 1, unreviewed: 0, repeated: 1, solved: 0 },
  availableTags: ['한자 읽기'],
  observedAt: '2026-08-22T03:00:00.000Z'
})
const empty = {
  ...queue,
  items: [],
  total: 0,
  counts: { due: 0, unreviewed: 0, repeated: 0, solved: 0 }
}
const mount = (
  initialEntry = '/wrong-notes',
  state?: { reviewFocus: string }
) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const router = createMemoryRouter(
    [{ path: '/wrong-notes', element: <WrongNoteReviewCenterPage /> }],
    {
      initialEntries: [
        {
          pathname: initialEntry.split('?')[0],
          search: initialEntry.includes('?')
            ? `?${initialEntry.split('?')[1]}`
            : '',
          state
        }
      ]
    }
  )
  const rendered = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { client, router, ...rendered }
}
const serve = (): void => {
  mockServer.use(
    http.get('*/api/v1/review-queue', () => HttpResponse.json(queue))
  )
}

afterEach(() => {
  onlineManager.setOnline(true)
  auth.role = 'USER'
  vi.restoreAllMocks()
})
describe('approved integrated review', () => {
  it('uses native range and URL filters without offering a bulk session', async () => {
    const seen: string[] = []
    mockServer.use(
      http.get('*/api/v1/review-queue', ({ request }) => {
        seen.push(new URL(request.url).search)
        return HttpResponse.json(queue)
      })
    )
    const { router } = mount('/wrong-notes?level=N5&page=1&owner=x')
    await screen.findByText(queue.items[0]!.questionPreview)
    expect(router.state.location.search).toBe('?level=N5')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '복습 범위' }),
      'SOLVED'
    )
    await waitFor(() =>
      expect(router.state.location.search).toBe('?view=SOLVED&level=N5')
    )
    expect(seen.some((url) => url.includes('view=SOLVED'))).toBe(true)
    expect(screen.getByRole('link', { name: /해설 보기/u })).toHaveAttribute(
      'href',
      expect.stringContaining(
        encodeURIComponent('/wrong-notes?view=SOLVED&level=N5')
      )
    )
    expect(
      screen.queryByRole('button', { name: /복습 시작/u })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /전체.*기록/u })
    ).not.toBeInTheDocument()
  })
  it('retains advanced disclosure and focused control after filter changes', async () => {
    serve()
    mount()
    await screen.findByText(queue.items[0]!.questionPreview)
    await userEvent.click(screen.getByText('상세 조건'))
    const sort = screen.getByRole('combobox', { name: '정렬' })
    sort.focus()
    await userEvent.selectOptions(sort, 'MOST_WRONG')
    await waitFor(() => expect(sort).toHaveValue('MOST_WRONG'))
    expect(sort).toHaveFocus()
    expect(screen.getByText('상세 조건').closest('details')).toHaveAttribute(
      'open'
    )
  })
  it('does not label a zero due queue as zero lifetime wrong notes', async () => {
    mockServer.use(
      http.get('*/api/v1/review-queue', () => HttpResponse.json(empty)),
      http.get('*/api/v1/wrong-notes', () =>
        HttpResponse.json({
          items: [],
          total: 1,
          page: 1,
          pageSize: 20,
          availableTags: []
        })
      )
    )
    mount()
    expect(await screen.findByText('지금 복습할 문제가 없어요.')).toBeVisible()
    expect(
      screen.queryByText('아직 복습할 문제가 없어요.')
    ).not.toBeInTheDocument()
  })
  it('uses successful unfiltered history zero for the first-study empty state', async () => {
    mockServer.use(
      http.get('*/api/v1/review-queue', () => HttpResponse.json(empty)),
      http.get('*/api/v1/wrong-notes', () =>
        HttpResponse.json({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          availableTags: []
        })
      )
    )
    mount()
    expect(await screen.findByText('아직 복습할 문제가 없어요.')).toBeVisible()
  })
  it('restores the originating row after a fresh queue read', async () => {
    serve()
    mount('/wrong-notes', { reviewFocus: queue.items[0]!.questionId })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /해설 보기/u })).toHaveFocus()
    )
  })
  it('falls back to result count when the originating row leaves the view', async () => {
    serve()
    mount('/wrong-notes', { reviewFocus: 'absent-question' })
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '1문제' })).toHaveFocus()
    )
  })
  it('shows offline state instead of a perpetual loading spinner', async () => {
    act(() => onlineManager.setOnline(false))
    mount()
    expect(
      await screen.findByText(/현재 URL 조건으로 복습 대기열을 자동으로/u)
    ).toBeVisible()
    expect(
      screen.queryByText('복습 대기열을 불러오고 있습니다…')
    ).not.toBeInTheDocument()
  })
  it('offers a guest login without making member queue requests', async () => {
    auth.role = 'GUEST'
    const requests = vi.fn()
    mockServer.use(http.get('*/api/v1/review-queue', requests))
    mount()
    expect(screen.getByRole('link', { name: '로그인' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fwrong-notes'
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(requests).not.toHaveBeenCalled()
  })
})

it('uses the real queue page, retains conditions and focuses the selected number rather than the count heading', async () => {
  const items = Array.from({ length: 41 }, (_, index) => ({
    ...queue.items[0]!,
    questionId: crypto.randomUUID(),
    currentQuestionVersionId: crypto.randomUUID(),
    questionPreview:
      index === 0
        ? queue.items[0]!.questionPreview
        : `복습 목록 테스트 문제 ${index}`
  }))
  mockServer.use(
    http.get('*/api/v1/review-queue', ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get('page'))
      return HttpResponse.json(
        listReviewQueueResultSchema.parse({
          ...queue,
          items: items.slice((page - 1) * 20, page * 20),
          page,
          total: 41,
          counts: { ...queue.counts, due: 41, repeated: 41 }
        })
      )
    })
  )
  const { router } = mount('/wrong-notes?level=N5')
  await screen.findByText(queue.items[0]!.questionPreview)
  await userEvent.click(screen.getByRole('link', { name: '다음 페이지' }))
  await waitFor(() =>
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('2')
  )
  expect(screen.getByRole('link', { current: 'page' })).toHaveFocus()
  expect(router.state.location.search).toBe('?level=N5&page=2')
  expect(
    screen.getAllByRole('link', { name: /해설 보기/u })[0]
  ).toHaveAttribute(
    'href',
    expect.stringContaining(encodeURIComponent('/wrong-notes?level=N5&page=2'))
  )
  const level = screen.getByRole('combobox', { name: '급수' })
  level.focus()
  await act(async () => {
    await router.navigate(-1)
  })
  await waitFor(() =>
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('1')
  )
  expect(level).toHaveFocus()
  await userEvent.selectOptions(level, 'N4')
  await waitFor(() => expect(router.state.location.search).toBe('?level=N4'))
  expect(level).toHaveFocus()
})
it('shows a single real queue page and hides the pager for filtered zero', async () => {
  serve()
  const first = mount()
  await screen.findByText(queue.items[0]!.questionPreview)
  expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('1')
  for (const label of [
    '첫 페이지',
    '이전 페이지',
    '다음 페이지',
    '마지막 페이지'
  ])
    expect(screen.getByRole('link', { name: label })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  first.unmount()
  first.client.clear()
  mockServer.use(
    http.get('*/api/v1/review-queue', () => HttpResponse.json(empty))
  )
  mount('/wrong-notes?level=N1')
  await screen.findByText('이 조건에 맞는 문제가 없어요.')
  expect(
    screen.queryByRole('navigation', { name: '복습 대기열 페이지' })
  ).not.toBeInTheDocument()
  expect(
    within(
      screen.getByRole('region', { name: '이 조건에 맞는 문제가 없어요.' })
    ).getByRole('button', { name: '조건 초기화' })
  ).toBeInTheDocument()
})

it.each(['success', 'error'] as const)(
  'hides the previous due zero while unreviewed loads and preserves %s handling',
  async (outcome) => {
    const user = userEvent.setup()
    const unreviewed = listReviewQueueResultSchema.parse({
      ...queue,
      items: Array.from({ length: 3 }, (_, index) => ({
        ...queue.items[0]!,
        questionId: crypto.randomUUID(),
        currentQuestionVersionId: crypto.randomUUID(),
        questionPreview: `필터 전환 테스트 문제 ${index + 1}`,
        status: 'NEW',
        wrongCount: 1,
        lastReviewedAt: null,
        nextReviewAt: '2026-08-23T03:00:00.000Z'
      })),
      total: 3,
      counts: { due: 0, unreviewed: 3, repeated: 0, solved: 0 }
    })
    let releaseResponse!: () => void
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    let recordRequest!: () => void
    const requested = new Promise<void>((resolve) => {
      recordRequest = resolve
    })
    const seen: Record<string, string>[] = []
    let failResponse = outcome === 'error'
    mockServer.use(
      http.get('*/api/v1/review-queue', async ({ request }) => {
        const params = Object.fromEntries(new URL(request.url).searchParams)
        seen.push(params)
        if (params.view === 'DUE') {
          return HttpResponse.json({ ...empty, counts: unreviewed.counts })
        }
        recordRequest()
        await responseGate
        return failResponse
          ? HttpResponse.json(
              {
                code: 'SERVICE_UNAVAILABLE',
                message: 'synthetic queue failure',
                retryable: true
              },
              { status: 503 }
            )
          : HttpResponse.json(unreviewed)
      })
    )
    const view = mount('/wrong-notes?level=N5&subject=VOCABULARY')
    try {
      await screen.findByRole('heading', { name: '0문제' })
      const range = screen.getByRole('combobox', { name: '복습 범위' })
      range.focus()
      await user.selectOptions(range, 'UNREVIEWED')
      await requested
      expect(range).toHaveValue('UNREVIEWED')
      expect(range).toHaveFocus()
      expect(view.router.state.location.search).toBe(
        '?view=UNREVIEWED&level=N5&subject=VOCABULARY'
      )
      expect(seen.at(-1)).toEqual({
        view: 'UNREVIEWED',
        level: 'N5',
        subject: 'VOCABULARY',
        sort: 'NEXT_REVIEW',
        page: '1',
        pageSize: '20'
      })
      expect(
        view.client.getQueryCache().findAll({
          queryKey: ['wrong-note', 'review-queue']
        })
      ).toHaveLength(2)
      expect(
        screen.queryByRole('heading', { name: '0문제' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('region', {
          name: '이 조건에 맞는 문제가 없어요.'
        })
      ).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent(
        '복습 대기열을 불러오고 있습니다…'
      )
      await act(async () => releaseResponse())
      if (outcome === 'error') {
        const error = await screen.findByRole('alert')
        expect(error).toHaveTextContent('복습 대기열을 불러오지 못했습니다')
        expect(
          screen.queryByRole('heading', { name: '0문제' })
        ).not.toBeInTheDocument()
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
        failResponse = false
        await user.click(within(error).getByRole('button'))
      }
      await screen.findByRole('heading', { name: '3문제' })
      expect(screen.getAllByRole('link', { name: /해설 보기/u })).toHaveLength(
        3
      )
      expect(
        screen.queryByRole('heading', { name: '0문제' })
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(range).toHaveValue('UNREVIEWED')
      expect(view.router.state.location.search).toBe(
        '?view=UNREVIEWED&level=N5&subject=VOCABULARY'
      )
      if (outcome === 'error') {
        await waitFor(() =>
          expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
        )
      } else expect(range).toHaveFocus()
    } finally {
      releaseResponse()
      view.unmount()
      view.client.clear()
    }
  }
)

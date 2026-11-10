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
import type { ListReviewListResponse } from '@nihongo/contracts/wrong-note/list-review-list'
import { listReviewListResultSchema } from '@api/wrong-note/listReviewList/schema'
import { WrongNoteReviewCenterPage } from '@app/wrong-note/center/page'
import {
  getSafeWrongNoteReturnTo,
  toReviewListSearch
} from '@app/wrong-note/wrongNoteReturnTo'
import { appI18n } from '@nihongo/browser/i18n/config'
import { mockServer } from '@/test/server'

const auth = vi.hoisted(() => ({
  role: 'USER',
  user: { id: 'member', role: 'USER' }
}))
vi.mock('@nihongo/browser/provider/ProtectedRouteProvider', () => ({
  useAuth: () => ({ ...auth, isReady: true })
}))

const t = (key: string, options?: Record<string, unknown>): string =>
  appI18n.t(`wrongNote:${key}`, options)

const toReviewItem = {
  questionId: crypto.randomUUID(),
  currentQuestionVersionId: crypto.randomUUID(),
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  questionPreview: '「川」의 읽는 법은 어느 것입니까.',
  reviewState: 'TO_REVIEW',
  wrongCount: 3,
  lastWrongAt: '2026-11-06T02:00:00.000Z',
  lastReviewedAt: null
} as const
const reviewedItem = {
  ...toReviewItem,
  questionId: crypto.randomUUID(),
  questionPreview: '「山」의 읽는 법은 어느 것입니까.',
  reviewState: 'REVIEWED',
  wrongCount: 1,
  lastReviewedAt: '2026-11-08T02:00:00.000Z'
} as const

const page = (
  state: 'TO_REVIEW' | 'REVIEWED',
  counts: { toReview: number; reviewed: number },
  items: unknown[] = []
): ListReviewListResponse =>
  listReviewListResultSchema.parse({
    items,
    page: 1,
    pageSize: 20,
    total: state === 'TO_REVIEW' ? counts.toReview : counts.reviewed,
    state,
    counts,
    oldestToReview:
      counts.toReview > 0 ? { level: 'N4', subject: 'GRAMMAR' } : null,
    observedAt: '2026-11-09T03:00:00.000Z'
  })

const mount = (
  initialEntry = '/wrong-notes',
  state?: { reviewFocus: string }
) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const [pathname, search] = initialEntry.split('?')
  const router = createMemoryRouter(
    [
      { path: '/wrong-notes', element: <WrongNoteReviewCenterPage /> },
      { path: '/practice/session/:id', element: <h1>세션 도착</h1> }
    ],
    {
      initialEntries: [
        { pathname: pathname!, search: search ? `?${search}` : '', state }
      ]
    }
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { router }
}

type Responder = (query: URLSearchParams) => ListReviewListResponse
const serve = (respond: Responder): URLSearchParams[] => {
  const seen: URLSearchParams[] = []
  mockServer.use(
    http.get('*/api/v1/review-list', ({ request }) => {
      const query = new URL(request.url).searchParams
      seen.push(query)
      return HttpResponse.json(respond(query))
    })
  )
  return seen
}
const serveDefault = (): URLSearchParams[] =>
  serve((query) =>
    query.get('state') === 'REVIEWED'
      ? page('REVIEWED', { toReview: 1, reviewed: 1 }, [reviewedItem])
      : page('TO_REVIEW', { toReview: 1, reviewed: 1 }, [toReviewItem])
  )

afterEach(() => {
  onlineManager.setOnline(true)
  auth.role = 'USER'
  vi.restoreAllMocks()
})

describe('wrong note in two states', () => {
  it('shows two tabs, one rule line, level chips and the to-review list', async () => {
    serveDefault()
    const { router } = mount('/wrong-notes?view=DUE&owner=x')
    await screen.findByText(toReviewItem.questionPreview)
    expect(router.state.location.search).toBe('')
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(t('rule'))).toBeVisible()
    expect(screen.getByRole('button', { name: t('levelAll') })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    const row = screen.getByText(toReviewItem.questionPreview).closest('li')
    if (!row) throw new Error('Row required')
    expect(
      within(row).getByText(t('card.wrongCount', { count: 3 }))
    ).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: t('start') })
    ).not.toHaveLength(0)
  })

  it('switches tabs with the arrow key and keeps the level in the URL', async () => {
    const seen = serveDefault()
    const user = userEvent.setup()
    const { router } = mount('/wrong-notes?level=N5')
    await screen.findByText(toReviewItem.questionPreview)
    screen.getAllByRole('tab')[0]!.focus()
    await user.keyboard('{ArrowRight}')
    await screen.findByText(reviewedItem.questionPreview)
    expect(router.state.location.search).toBe('?state=REVIEWED&level=N5')
    expect(screen.getAllByRole('tab')[1]).toHaveFocus()
    expect(
      seen.some(
        (query) =>
          query.get('state') === 'REVIEWED' && query.get('level') === 'N5'
      )
    ).toBe(true)
    expect(screen.queryByRole('button', { name: t('start') })).toBeNull()
  })

  it('keeps tab counts unfiltered when a level chip is picked', async () => {
    const seen = serve((query) =>
      query.get('level') === 'N1'
        ? page('TO_REVIEW', { toReview: 0, reviewed: 0 })
        : page('TO_REVIEW', { toReview: 4, reviewed: 2 }, [toReviewItem])
    )
    const user = userEvent.setup()
    const { router } = mount()
    await screen.findByText(toReviewItem.questionPreview)
    await user.click(screen.getByRole('button', { name: 'N1' }))
    expect(
      await screen.findByText(t('empty.levelNone', { level: 'N1' }))
    ).toBeVisible()
    expect(router.state.location.search).toBe('?level=N1')
    expect(screen.getByRole('button', { name: 'N1' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getAllByRole('tab')[0]).toHaveTextContent(
      t('tabs.toReview', { count: 4, formattedCount: '4' })
    )
    expect(seen.some((query) => !query.has('level'))).toBe(true)
    await user.click(screen.getByRole('button', { name: t('empty.showAll') }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it.each([
    ['never', 'TO_REVIEW', { toReview: 0, reviewed: 0 }],
    ['allDone', 'TO_REVIEW', { toReview: 0, reviewed: 2 }],
    ['noReviewed', 'REVIEWED', { toReview: 2, reviewed: 0 }]
  ] as const)('shows the %s empty screen', async (variant, state, counts) => {
    serve(() => page(state, counts))
    mount(state === 'REVIEWED' ? '/wrong-notes?state=REVIEWED' : '/wrong-notes')
    expect(
      await screen.findByRole('heading', { name: t(`empty.${variant}.title`) })
    ).toBeVisible()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    if (variant === 'noReviewed')
      expect(screen.getByRole('button', { name: t('start') })).toBeEnabled()
    else
      expect(
        screen.getByRole('link', { name: t('empty.startNew') })
      ).toHaveAttribute('href', '/practice')
  })

  it('starts DAILY_REVIEW on the oldest wrong answer level and subject', async () => {
    serveDefault()
    const bodies: unknown[] = []
    mockServer.use(
      http.post('*/api/v1/study-sessions', async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(
          {
            code: 'NO_ELIGIBLE_QUESTIONS',
            message: 'none',
            requestId: crypto.randomUUID(),
            retryable: false
          },
          { status: 404 }
        )
      })
    )
    const user = userEvent.setup()
    mount()
    await screen.findByText(toReviewItem.questionPreview)
    await user.click(screen.getAllByRole('button', { name: t('start') })[0]!)
    expect(await screen.findByRole('alert')).toHaveTextContent(t('startEmpty'))
    expect(bodies).toEqual([
      { level: 'N4', subject: 'GRAMMAR', mode: 'DAILY_REVIEW', count: 10 }
    ])
  })

  it('returns focus to the row the learner opened', async () => {
    serveDefault()
    mount('/wrong-notes', { reviewFocus: toReviewItem.questionId })
    await waitFor(() =>
      expect(
        screen.getByText(toReviewItem.questionPreview).closest('a')
      ).toHaveFocus()
    )
  })

  it('shows the offline state instead of a perpetual skeleton', async () => {
    act(() => onlineManager.setOnline(false))
    mount()
    expect(await screen.findByText(t('center.states.offline'))).toBeVisible()
  })

  it('offers a guest login without making member list requests', () => {
    auth.role = 'GUEST'
    const requests = vi.fn()
    mockServer.use(http.get('*/api/v1/review-list', requests))
    mount()
    expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(requests).not.toHaveBeenCalled()
  })
})

describe('review list search', () => {
  it('maps old four-way links onto the two tabs', () => {
    expect(toReviewListSearch(new URLSearchParams('status=SOLVED'))).toBe(
      'state=REVIEWED'
    )
    expect(
      toReviewListSearch(new URLSearchParams('view=REPEATED&level=N3&tag=x'))
    ).toBe('level=N3')
    expect(getSafeWrongNoteReturnTo('/wrong-notes?state=REVIEWED')).toBe(
      '/wrong-notes?state=REVIEWED'
    )
    expect(getSafeWrongNoteReturnTo('https://evil.example/wrong-notes')).toBe(
      '/wrong-notes'
    )
    expect(getSafeWrongNoteReturnTo('/dashboard')).toBe('/wrong-notes')
  })
})

import { useRef } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import {
  createMemoryRouter,
  RouterProvider,
  useSearchParams
} from 'react-router'
import { afterEach, expect, it } from 'vitest'
import { listResumableStudySessionsResponseSchema } from '@nihongo/contracts/study/list-resumable-study-sessions'
import { ResumablePractice } from '@app/practice/components/ResumablePractice'
import { useListResumableStudySessions } from '@app/practice/hooks/useListResumableStudySessions'
import { mockServer } from '@/test/server'
import { appI18n } from '@nihongo/browser/i18n/config'
import { LearningEntry } from '@app/dashboard/components/LearningEntry'
import { useAppStore } from '@nihongo/browser/store/index'

const clients: QueryClient[] = []
afterEach(() => {
  clients.forEach((client) => client.clear())
  clients.length = 0
})
const Harness = () => {
  const [search, setSearch] = useSearchParams()
  const page = Number(search.get('resumePage') ?? 1)
  const query = useListResumableStudySessions(page, 5)
  const heading = useRef<HTMLHeadingElement>(null)
  const nextSearch = (nextPage: number): URLSearchParams => {
    const next = new URLSearchParams(search)
    if (nextPage === 1) next.delete('resumePage')
    else next.set('resumePage', String(nextPage))
    return next
  }
  return (
    <ResumablePractice
      query={query}
      canLoad
      requestedPage={page}
      pageCount={Math.max(1, Math.ceil((query.data?.total ?? 0) / 5))}
      sourceUnavailable={query.isError || query.fetchStatus === 'paused'}
      interactionLocked={
        query.isFetching || query.isError || query.fetchStatus === 'paused'
      }
      headingRef={heading}
      getPageHref={(next) => `?${nextSearch(next).toString()}`}
      onPageChange={(next) => setSearch(nextSearch(next))}
      onCancel={() => undefined}
    />
  )
}
const mount = (total: number, legacy = false, dashboard = false) => {
  const items = Array.from({ length: total }, () => ({
    id: crypto.randomUUID(),
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    status: 'IN_PROGRESS',
    actualCount: 5,
    startedAt: '2026-10-12T01:00:00Z',
    expiresAt: '2026-10-14T01:00:00Z',
    practiceContractVersion: 2,
    draftRevision: 0,
    draftSavedAt: null,
    currentOrdinal: 1,
    resumeAvailability: 'SERVER'
  }))
  if (legacy && items[0]) {
    Object.assign(items[0], {
      practiceContractVersion: 1,
      draftRevision: null,
      currentOrdinal: null,
      resumeAvailability: 'LEGACY_LOCAL_ONLY'
    })
    useAppStore.getState().beginPractice(items[0].id, items[0].startedAt)
  }
  mockServer.use(
    http.get('*/api/v1/study-sessions', ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get('page'))
      const body = listResumableStudySessionsResponseSchema.parse({
        items: items.slice((page - 1) * 5, page * 5),
        total,
        page,
        pageSize: 5
      })
      return HttpResponse.json(body, {
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Nihongo-Practice-Contract': '2'
        }
      })
    })
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  clients.push(client)
  const router = createMemoryRouter(
    [
      {
        path: '/practice',
        element: dashboard ? <LearningEntry isMember /> : <Harness />
      }
    ],
    { initialEntries: ['/practice?level=N5&mode=RANDOM'] }
  )
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { router, ...view }
}
it('does not resume or cancel an older local-only session', async () => {
  mount(1, true)
  expect(
    await screen.findByText(
      appI18n.t('practice:setup.resume.legacyUnavailable')
    )
  ).toBeVisible()
  expect(
    screen.queryByRole('link', {
      name: appI18n.t('practice:setup.resume.action')
    })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', {
      name: appI18n.t('practice:setup.resume.cancel')
    })
  ).not.toBeInTheDocument()
})
it('does not resume a retired dashboard session even when its local identifier matches', async () => {
  mount(1, true, true)
  expect(
    await screen.findByText(appI18n.t('home:entry.legacyUnavailable'))
  ).toBeVisible()
  expect(
    screen.queryByRole('link', { name: appI18n.t('home:entry.resume') })
  ).not.toBeInTheDocument()
})
it('preserves a single resumable banner without adding a one-item list pager', async () => {
  mount(1)
  expect(
    await screen.findByRole('link', {
      name: appI18n.t('practice:setup.resume.action')
    })
  ).toHaveAttribute('href', expect.stringContaining('/practice/session/'))
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', {
      name: appI18n.t('practice:setup.resume.otherAction')
    })
  ).not.toBeInTheDocument()
})
it.each([2, 5])(
  'shows one real page only in the expanded multiple-session list (%s)',
  async (total) => {
    mount(total)
    await userEvent.click(
      await screen.findByRole('button', {
        name: appI18n.t('practice:setup.resume.otherAction')
      })
    )
    const nav = screen.getByRole('navigation', {
      name: appI18n.t('practice:setup.resume.paginationLabel')
    })
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('1')
    expect(nav.querySelectorAll('[aria-disabled="true"]')).toHaveLength(4)
    expect(
      screen.getAllByRole('link', {
        name: appI18n.t('practice:setup.resume.action')
      })
    ).toHaveLength(total)
  }
)
it('hides the source after a confirmed empty response without inventing one page', async () => {
  mount(0)
  await waitFor(() =>
    expect(
      screen.queryByText(appI18n.t('practice:setup.resume.loading'))
    ).not.toBeInTheDocument()
  )
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})
it('keeps new-study settings through list paging and Back while focusing only the user-selected page', async () => {
  const { router } = mount(6)
  await userEvent.click(
    await screen.findByRole('button', {
      name: appI18n.t('practice:setup.resume.otherAction')
    })
  )
  await userEvent.click(screen.getByRole('link', { name: '다음 페이지' }))
  await waitFor(() =>
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('2')
  )
  expect(screen.getByRole('link', { current: 'page' })).toHaveFocus()
  expect(router.state.location.search).toBe(
    '?level=N5&mode=RANDOM&resumePage=2'
  )
  await act(async () => {
    await router.navigate(-1)
  })
  await waitFor(() =>
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('1')
  )
  expect(router.state.location.search).toBe('?level=N5&mode=RANDOM')
})

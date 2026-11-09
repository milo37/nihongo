import { useRef } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import { listResumableStudySessionsResponseSchema } from '@nihongo/contracts/study/list-resumable-study-sessions'
import { ResumablePractice } from '@app/practice/components/ResumablePractice'
import { useListResumableStudySessions } from '@app/practice/hooks/useListResumableStudySessions'
import { mockServer } from '@/test/server'
import { appI18n } from '@nihongo/browser/i18n/config'
import { useAppStore } from '@nihongo/browser/store/index'

const clients: QueryClient[] = []
afterEach(() => {
  clients.forEach((client) => client.clear())
  clients.length = 0
})
// The setup screen asks for the most recent session only (page 1, size 1).
const Harness = () => {
  const query = useListResumableStudySessions(1, 1)
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <ResumablePractice
      query={query}
      canLoad
      sourceUnavailable={query.isError || query.fetchStatus === 'paused'}
      interactionLocked={
        query.isFetching || query.isError || query.fetchStatus === 'paused'
      }
      headingRef={heading}
      onCancel={() => undefined}
    />
  )
}
const mount = (total: number, legacy = false) => {
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
      const params = new URL(request.url).searchParams
      const page = Number(params.get('page'))
      const pageSize = Number(params.get('pageSize'))
      const body = listResumableStudySessionsResponseSchema.parse({
        items: items.slice((page - 1) * pageSize, page * pageSize),
        total,
        page,
        pageSize
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
        element: <Harness />
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
it.each([1, 6])(
  'shows only the most recent session with no list, pager or more button (%s saved)',
  async (total) => {
    mount(total)
    expect(
      await screen.findByRole('link', {
        name: appI18n.t('practice:setup.resume.action')
      })
    ).toHaveAttribute('href', expect.stringContaining('/practice/session/'))
    expect(
      screen.getAllByRole('link', {
        name: appI18n.t('practice:setup.resume.action')
      })
    ).toHaveLength(1)
    expect(
      screen.getByRole('button', {
        name: appI18n.t('practice:setup.resume.cancel')
      })
    ).toBeVisible()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: appI18n.t('practice:setup.resume.otherAction')
      })
    ).not.toBeInTheDocument()
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

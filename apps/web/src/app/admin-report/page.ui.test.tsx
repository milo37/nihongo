import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import {
  listAdminQuestionReportsQuerySchema,
  listAdminQuestionReportsResponseSchema,
  type QuestionReportSummary
} from '@nihongo/contracts/admin/phase7'
import { AdminQuestionReportPage } from '@app/admin-report/page'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
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

const createUuid = (value: number): string =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`

const reportFixtures: QuestionReportSummary[] = Array.from(
  { length: 21 },
  (_, index) => {
    const occurredAt = new Date(
      Date.UTC(2026, 8, 29, 0, 0, 21 - index)
    ).toISOString()
    return {
      id: createUuid(index + 1),
      questionId: createUuid(100),
      questionVersionId: createUuid(101),
      reason: index === 0 ? 'ANSWER_ERROR' : 'OTHER',
      status: 'OPEN',
      rowVersion: 1,
      reporter: {
        kind: 'ACCOUNT',
        actorId: createUuid(102),
        role: 'USER',
        label: 'ACTIVE_USER'
      },
      assignee: null,
      createdAt: occurredAt,
      updatedAt: occurredAt
    }
  }
)

describe('AdminQuestionReportPage pagination', () => {
  it('returns an out-of-range filtered page to the last valid page', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const correctionGate = createDeferred()
    let correctionStarted = false
    mockServer.use(
      http.get('*/api/v1/admin/question-reports', async ({ request }) => {
        const query = listAdminQuestionReportsQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams)
        )
        const matches = reportFixtures.filter(
          (report) =>
            (query.status === undefined || report.status === query.status) &&
            (query.reason === undefined || report.reason === query.reason)
        )
        const offset = (query.page - 1) * query.pageSize
        const response = listAdminQuestionReportsResponseSchema.parse({
          items: matches.slice(offset, offset + query.pageSize),
          page: query.page,
          pageSize: query.pageSize,
          total: matches.length
        })
        if (query.page === 2 && query.status === 'OPEN') {
          correctionStarted = true
          await correctionGate.promise
        }
        return HttpResponse.json(response, {
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Request-Id': crypto.randomUUID()
          }
        })
      })
    )
    const client = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false }
      }
    })
    const router = createMemoryRouter(
      [{ path: '/admin/reports', element: <AdminQuestionReportPage /> }],
      {
        initialEntries: [
          '/admin/reports?status=OPEN',
          '/admin/reports?page=9&status=OPEN'
        ],
        initialIndex: 1
      }
    )
    const rendered = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(
        new URLSearchParams(router.state.location.search).get('page')
      ).toBe('2')
    })
    await waitFor(() => expect(correctionStarted).toBe(true))
    expect(screen.getByRole('status')).toHaveTextContent(
      '신고 큐 페이지를 갱신하고 있습니다…'
    )
    expect(document.querySelector('#admin-report-results')).toHaveAttribute(
      'aria-busy',
      'true'
    )
    expect(
      screen.queryByRole('heading', { name: '신고가 없습니다' })
    ).not.toBeInTheDocument()

    await act(async () => correctionGate.release())
    await screen.findByRole('table', { name: /문제 신고 큐 목록/u })
    expect(document.querySelector('#admin-report-results')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    expect(
      new URLSearchParams(router.state.location.search).get('status')
    ).toBe('OPEN')

    await act(async () => {
      await router.navigate(-1)
    })
    await waitFor(() => {
      expect(router.state.location.search).toBe('?status=OPEN')
    })

    rendered.unmount()
    client.clear()
  })

  it('announces an empty-to-results transition while retaining placeholder data', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const resultsGate = createDeferred()
    let resultsStarted = false
    mockServer.use(
      http.get('*/api/v1/admin/question-reports', async ({ request }) => {
        const query = listAdminQuestionReportsQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams)
        )
        const matches = reportFixtures.filter(
          (report) =>
            query.reason === undefined || report.reason === query.reason
        )
        const offset = (query.page - 1) * query.pageSize
        const response = listAdminQuestionReportsResponseSchema.parse({
          items: matches.slice(offset, offset + query.pageSize),
          page: query.page,
          pageSize: query.pageSize,
          total: matches.length
        })
        if (query.reason === undefined) {
          resultsStarted = true
          await resultsGate.promise
        }
        return HttpResponse.json(response, {
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Request-Id': crypto.randomUUID()
          }
        })
      })
    )
    const client = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false }
      }
    })
    const router = createMemoryRouter(
      [{ path: '/admin/reports', element: <AdminQuestionReportPage /> }],
      { initialEntries: ['/admin/reports?reason=TYPO_OR_GRAMMAR'] }
    )
    const rendered = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    await screen.findByRole('heading', { name: '신고가 없습니다' })

    await act(async () => router.navigate('/admin/reports'))
    await waitFor(() => expect(resultsStarted).toBe(true))
    expect(screen.getByRole('status')).toHaveTextContent(
      '신고 큐 페이지를 갱신하고 있습니다…'
    )
    expect(document.querySelector('#admin-report-results')).toHaveAttribute(
      'aria-busy',
      'true'
    )
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await act(async () => resultsGate.release())
    await screen.findByRole('table', { name: /문제 신고 큐 목록/u })
    expect(document.querySelector('#admin-report-results')).toHaveAttribute(
      'aria-busy',
      'false'
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    rendered.unmount()
    client.clear()
  })

  it('does not clamp a valid page restored by browser back with placeholder totals', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const pageTwoGate = createDeferred()
    let pageTwoStarted = false
    mockServer.use(
      http.get('*/api/v1/admin/question-reports', async ({ request }) => {
        const url = new URL(request.url)
        const query = listAdminQuestionReportsQuerySchema.parse(
          Object.fromEntries(url.searchParams)
        )
        const matches = reportFixtures.filter(
          (report) =>
            query.reason === undefined || report.reason === query.reason
        )
        const offset = (query.page - 1) * query.pageSize
        const response = listAdminQuestionReportsResponseSchema.parse({
          items: matches.slice(offset, offset + query.pageSize),
          page: query.page,
          pageSize: query.pageSize,
          total: matches.length
        })
        if (query.page === 2 && query.reason === undefined) {
          pageTwoStarted = true
          await pageTwoGate.promise
        }
        return HttpResponse.json(response, {
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Request-Id': crypto.randomUUID()
          }
        })
      })
    )
    const client = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false }
      }
    })
    const router = createMemoryRouter(
      [{ path: '/admin/reports', element: <AdminQuestionReportPage /> }],
      {
        initialEntries: [
          '/admin/reports?page=2',
          '/admin/reports?reason=ANSWER_ERROR'
        ],
        initialIndex: 1
      }
    )
    const rendered = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    const table = await screen.findByRole('table', {
      name: /문제 신고 큐 목록/u
    })
    await act(async () => router.navigate(-1))
    await waitFor(() => expect(pageTwoStarted).toBe(true))
    expect(router.state.location.search).toBe('?page=2')
    expect(
      screen.getByText('신고 큐 페이지를 갱신하고 있습니다…')
    ).toHaveAttribute('role', 'status')
    expect(table).toHaveAttribute('aria-busy', 'true')

    await act(async () => pageTwoGate.release())
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(router.state.location.search).toBe('?page=2')
    expect(
      screen.queryByText('신고 큐 페이지를 갱신하고 있습니다…')
    ).not.toBeInTheDocument()
    expect(table).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('2')
    rendered.unmount()
    client.clear()
  })
})

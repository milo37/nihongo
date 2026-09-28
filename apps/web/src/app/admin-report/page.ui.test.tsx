import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AdminQuestionReportPage } from '@app/admin-report/page'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'

describe('AdminQuestionReportPage pagination', () => {
  it('returns an out-of-range filtered page to the last valid page', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const client = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false }
      }
    })
    const router = createMemoryRouter(
      [{ path: '/admin/reports', element: <AdminQuestionReportPage /> }],
      { initialEntries: ['/admin/reports?page=9&status=OPEN'] }
    )
    const rendered = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(
        new URLSearchParams(router.state.location.search).get('page')
      ).toBe('1')
    })
    expect(
      new URLSearchParams(router.state.location.search).get('status')
    ).toBe('OPEN')

    rendered.unmount()
    client.clear()
  })
})

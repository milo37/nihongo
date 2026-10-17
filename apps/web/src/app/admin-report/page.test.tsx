import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { questionReportSummarySchema } from '@nihongo/contracts/admin/phase7'
import { beforeEach, expect, it, vi } from 'vitest'
import { AdminReportPage } from '@app/admin-report/page'
import { queryClient } from '@libs/queryClient'
import { I18nProvider } from '@provider/I18nProvider'
const hooks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@app/admin-report/hooks/useAdminReportQueries', () => ({
  useAdminReportList: hooks.list
}))
const id = '018f6b7a-1f4b-7d5e-8a91-4c27df9c7101'
const item = questionReportSummarySchema.parse({
  id,
  questionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7102',
  questionVersionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7103',
  reason: 'OTHER',
  status: 'OPEN',
  rowVersion: 1,
  reporter: {
    kind: 'ACCOUNT',
    actorId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7104',
    role: 'USER',
    label: 'ACTIVE_USER'
  },
  assignee: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z'
})
const ready = {
  data: { items: [item], page: 1, pageSize: 20, total: 1 },
  isSuccess: true,
  isPending: false,
  isError: false,
  isFetching: false,
  isPlaceholderData: false,
  fetchStatus: 'idle',
  error: null,
  refetch: vi.fn()
}
const renderList = (entry = '/admin/reports') => {
  const router = createMemoryRouter(
    [
      { path: '/admin/reports', element: <AdminReportPage /> },
      { path: '/admin/reports/:reportId', element: <p>detail destination</p> }
    ],
    { initialEntries: [entry] }
  )
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  )
  return router
}
beforeEach(() => {
  hooks.list.mockReset()
  hooks.list.mockReturnValue(ready)
})
it('renders only summary fields and a full href with allowlisted return filters', async () => {
  renderList('/admin/reports?status=OPEN&reason=OTHER')
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    '문제 신고 관리'
  )
  const link = screen.getByRole('link', { name: `기타 신고 ${id} 상세` })
  const destination = new URL(
    link.getAttribute('href') ?? '',
    'https://example.test'
  )
  expect(destination.pathname).toBe(`/admin/reports/${id}`)
  const returnTo = new URL(
    destination.searchParams.get('returnTo') ?? '',
    'https://example.test'
  )
  expect(returnTo.searchParams.get('status')).toBe('OPEN')
  expect(returnTo.searchParams.get('reason')).toBe('OTHER')
  expect(returnTo.searchParams.get('focusReport')).toBe(id)
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByText('신고 설명')).not.toBeInTheDocument()
  expect(hooks.list).toHaveBeenCalledWith(
    {
      page: 1,
      pageSize: 20,
      sort: 'UPDATED_DESC',
      status: 'OPEN',
      reason: 'OTHER'
    },
    true
  )
})
it('preserves unsubmitted advanced inputs across collapse and immediate status changes, then resets page on apply', async () => {
  hooks.list.mockReturnValue({
    ...ready,
    data: undefined,
    isPending: true,
    isSuccess: false
  })
  const user = userEvent.setup()
  const router = renderList('/admin/reports?page=3')
  await user.click(screen.getByRole('button', { name: '상세 조건' }))
  const input = screen.getByRole('textbox', { name: '담당자 actor ID' })
  await user.type(input, '018f6b7a-1f4b-7d5e-8a91-4c27df9c7105')
  await user.click(screen.getByRole('button', { name: '상세 조건' }))
  await user.selectOptions(
    screen.getByRole('combobox', { name: '처리 상태' }),
    'TRIAGED'
  )
  await user.click(screen.getByRole('button', { name: '상세 조건' }))
  expect(screen.getByRole('textbox', { name: '담당자 actor ID' })).toHaveValue(
    '018f6b7a-1f4b-7d5e-8a91-4c27df9c7105'
  )
  await user.click(screen.getByRole('button', { name: '검색 적용' }))
  expect(new URLSearchParams(router.state.location.search).get('page')).toBe(
    '1'
  )
  expect(new URLSearchParams(router.state.location.search).get('status')).toBe(
    'TRIAGED'
  )
  expect(
    new URLSearchParams(router.state.location.search).get('assigneeActorId')
  ).toBe('018f6b7a-1f4b-7d5e-8a91-4c27df9c7105')
})
it('restores committed filters through browser Back', async () => {
  const user = userEvent.setup()
  const router = renderList('/admin/reports?reason=OTHER')
  await user.selectOptions(
    screen.getByRole('combobox', { name: '처리 상태' }),
    'TRIAGED'
  )
  await act(async () => {
    await router.navigate(-1)
  })
  expect(screen.getByRole('combobox', { name: '처리 상태' })).toHaveValue('')
  expect(screen.getByRole('combobox', { name: '신고 사유' })).toHaveValue(
    'OTHER'
  )
})
it('focuses the report row when returning to the list', async () => {
  renderList(`/admin/reports?focusReport=${id}`)
  const link = screen.getByRole('link', { name: `기타 신고 ${id} 상세` })
  await waitFor(() => expect(link).toHaveFocus())
})
it('keeps previous rows while a page is pending, but disables their detail destinations', () => {
  hooks.list.mockReturnValue({
    ...ready,
    isPlaceholderData: true,
    isFetching: true
  })
  renderList('/admin/reports?page=2')
  expect(
    screen.getByText(item.questionId, { exact: false })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: `기타 신고 ${id} 상세` })
  ).not.toBeInTheDocument()
  expect(screen.getByText('상세')).toHaveAttribute('aria-disabled', 'true')
})
it('retains cached rows and offers a retry while offline', () => {
  hooks.list.mockReturnValue({ ...ready, fetchStatus: 'paused' })
  renderList()
  expect(screen.getByRole('alert')).toHaveTextContent('오프라인')
  expect(
    screen.getByRole('button', { name: '신고 큐 다시 확인' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: `기타 신고 ${id} 상세` })
  ).toBeInTheDocument()
})
it('does not query invalid filters or label a failed load as empty', () => {
  hooks.list.mockReturnValue({
    ...ready,
    data: undefined,
    isSuccess: false,
    isError: true
  })
  renderList('/admin/reports?reason=INVALID')
  expect(hooks.list).toHaveBeenCalledWith(
    { page: 1, pageSize: 20, sort: 'UPDATED_DESC' },
    false
  )
  expect(screen.getByRole('alert')).toHaveTextContent('URL 신고 검색 조건')
  expect(screen.queryByText('신고가 없습니다')).not.toBeInTheDocument()
})

it('shows empty only for a successful settled empty response', () => {
  hooks.list.mockReturnValue({
    ...ready,
    data: { items: [], page: 1, pageSize: 20, total: 0 }
  })
  renderList()
  expect(screen.getByText('신고가 없습니다')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
it('shows an initial loading state distinct from empty or failed data', () => {
  hooks.list.mockReturnValue({
    ...ready,
    data: undefined,
    isSuccess: false,
    isPending: true
  })
  renderList()
  expect(screen.getByRole('status')).toHaveTextContent('신고 큐를 불러오는 중')
  expect(screen.queryByText('신고가 없습니다')).not.toBeInTheDocument()
})

it('D505-B2 list keeps the report list as the current page and advanced inputs usable after collapse', async () => {
  const user = userEvent.setup()
  renderList()
  const reportLink = screen.getByRole('link', {
    name: '신고 큐',
    current: 'page'
  })
  expect(reportLink).toHaveAttribute('href', '/admin/reports')
  await user.click(screen.getByRole('button', { name: '상세 조건' }))
  const assignee = screen.getByRole('textbox', { name: '담당자 actor ID' })
  await user.type(assignee, '018f6b7a-1f4b-7d5e-8a91-4c27df9c7105')
  await user.click(screen.getByRole('button', { name: '상세 조건' }))
  await user.click(screen.getByRole('button', { name: '상세 조건' }))
  expect(screen.getByRole('textbox', { name: '담당자 actor ID' })).toHaveValue(
    '018f6b7a-1f4b-7d5e-8a91-4c27df9c7105'
  )
})

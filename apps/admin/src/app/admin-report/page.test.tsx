import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import {
  questionReportDetailSchema,
  type ListAdminQuestionReportsQuery
} from '@nihongo/contracts/admin/phase7'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import { appDocumentNavigation } from '@nihongo/browser/libs/appNavigation'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import * as authApi from '@nihongo/browser/api/auth/getCurrentUser/index'
import * as api from '@nihongo/browser/api/content-operations/requestContentOperation'
import { useAppStore } from '@nihongo/browser/store/index'
import { adminRoutes } from '@/router'
const actorId = '10000000-0000-4000-8000-000000000001'
const id = '10000000-0000-4000-8000-000000000002'
const actor = (role: 'ADMIN' | 'USER' = 'ADMIN') => ({
  id: actorId,
  name: '관리자',
  role,
  targetLevel: 'N3' as const
})
const detail = questionReportDetailSchema.parse({
  id,
  questionId: actorId,
  questionVersionId: actorId,
  reason: 'OTHER',
  status: 'OPEN',
  rowVersion: 1,
  reporter: { kind: 'ACCOUNT', actorId, role: 'USER', label: 'ACTIVE_USER' },
  assignee: null,
  description: '목록에 보이면 안 되는 설명',
  descriptionDigest: '0'.repeat(64),
  resolution: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z'
})
const {
  description: _description,
  descriptionDigest: _digest,
  resolution: _resolution,
  ...summary
} = detail
const one = { items: [summary], page: 1, pageSize: 20, total: 1 }
const empty = { items: [], page: 1, pageSize: 20, total: 0 }
let client: QueryClient
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  invalidateCanonicalAuthTransitions()
  useAppStore.getState().setCurrentUser(null)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  client.clear()
  onlineManager.setOnline(true)
  writeUiLocalePreference('ko')
  vi.restoreAllMocks()
})
const route = (entry = '/admin/reports') => {
  const router = createMemoryRouter(adminRoutes, {
    basename: '/admin',
    initialEntries: [entry]
  })
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
  return router
}
it('registers the approved list, makes the canonical read, and never displays detail description', async () => {
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor())
  const read = vi.spyOn(api, 'requestContentOperation').mockResolvedValue(one)
  route()
  expect(
    await screen.findByRole('heading', { level: 1, name: '문제 신고 큐' })
  ).toBeVisible()
  await screen.findByRole('link', { name: '상세 · ' + id })
  expect(read).toHaveBeenCalledWith({
    operation: 'listAdminQuestionReports',
    params: {},
    query: { page: 1, pageSize: 20, sort: 'UPDATED_DESC' },
    body: undefined
  })
  expect(screen.queryByText(detail.description!)).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '신고 큐' })).toHaveAttribute(
    'aria-current',
    'page'
  )
})
it('distinguishes loading, settled empty, and retry after a read failure', async () => {
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor())
  let finish!: (value: typeof empty) => void
  const read = vi.spyOn(api, 'requestContentOperation').mockImplementation(
    () =>
      new Promise<typeof empty>((resolve) => {
        finish = resolve
      })
  )
  route()
  expect(await screen.findByText('신고 큐를 불러오는 중입니다…')).toBeVisible()
  expect(screen.queryByText('신고가 없습니다')).not.toBeInTheDocument()
  await act(async () => {
    finish(empty)
  })
  expect(
    await screen.findByRole('heading', { name: '신고가 없습니다' })
  ).toBeVisible()
  read.mockRejectedValueOnce({ code: 'SERVICE_UNAVAILABLE' })
  await act(async () => {
    await client.invalidateQueries()
  })
  expect(
    await screen.findByRole('heading', { name: /최신 신고 큐를 확인하지/ })
  ).toBeVisible()
  read.mockResolvedValue(empty)
  await userEvent.click(
    screen.getByRole('button', { name: '신고 큐 다시 확인' })
  )
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { level: 1, name: '문제 신고 큐' })
    ).toHaveFocus()
  )
})
it.each(['GUEST', 'USER'])(
  'denies %s before any report read or command',
  async (role) => {
    vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(
      role === 'GUEST' ? null : actor('USER')
    )
    const read = vi.spyOn(api, 'requestContentOperation')
    const replace = vi
      .spyOn(appDocumentNavigation, 'replace')
      .mockImplementation(() => undefined)
    route()
    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(read).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('heading', { name: '문제 신고 큐' })
    ).not.toBeInTheDocument()
  }
)
it('normalizes URL filters, resets pagination on explicit structured filter submission, and keeps Back history', async () => {
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor())
  const read = vi
    .spyOn(api, 'requestContentOperation')
    .mockImplementation(async (request) => {
      const query = request.query as ListAdminQuestionReportsQuery
      return { items: [], page: query.page, pageSize: 20, total: 0 }
    })
  const router = route('/admin/reports?status=OPEN&page=3')
  await screen.findByRole('heading', { name: '신고가 없습니다' })
  const user = userEvent.setup()
  await user.selectOptions(
    screen.getByRole('combobox', { name: '처리 상태' }),
    'TRIAGED'
  )
  await user.click(screen.getByRole('button', { name: '필터 적용' }))
  await waitFor(() =>
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe(
      '1'
    )
  )
  expect(new URLSearchParams(router.state.location.search).get('status')).toBe(
    'TRIAGED'
  )
  expect(read.mock.calls.at(-1)?.[0].query).toMatchObject({
    page: 1,
    status: 'TRIAGED'
  })
  await act(async () => {
    await router.navigate(-1)
  })
  expect(screen.getByRole('combobox', { name: '처리 상태' })).toHaveValue(
    'OPEN'
  )
})
it('falls back safely on unknown/duplicate URL filters without forwarding them', async () => {
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor())
  const read = vi.spyOn(api, 'requestContentOperation').mockResolvedValue(empty)
  route('/admin/reports?status=OPEN&status=TRIAGED&q=secret')
  expect(
    await screen.findByText(/URL 신고 검색 조건이 허용 범위/)
  ).toBeVisible()
  await screen.findByRole('heading', { name: '신고가 없습니다' })
  expect(read.mock.calls[0]?.[0].query).toEqual({
    page: 1,
    pageSize: 20,
    sort: 'UPDATED_DESC'
  })
})
it('returns from actual detail and browser Back to the same filtered list and focuses the original row once', async () => {
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor())
  vi.spyOn(api, 'requestContentOperation').mockImplementation(
    async (request) =>
      request.operation === 'getAdminQuestionReport' ? detail : one
  )
  const router = route('/admin/reports?reason=OTHER&page=1')
  const link = await screen.findByRole('link', { name: '상세 · ' + id })
  const user = userEvent.setup()
  await user.click(link)
  expect(
    await screen.findByRole('heading', { level: 1, name: '문제 신고 상세' })
  ).toBeVisible()
  expect(router.state.location.search).toBe('')
  await user.click(screen.getByRole('link', { name: '신고 목록으로' }))
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/admin/reports')
  )
  await waitFor(() =>
    expect(screen.getByRole('link', { name: '상세 · ' + id })).toHaveFocus()
  )
  expect(new URLSearchParams(router.state.location.search).get('reason')).toBe(
    'OTHER'
  )
  const filter = screen.getByRole('combobox', { name: '처리 상태' })
  await user.click(filter)
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['admin-content', 'reports'] })
  })
  await waitFor(() => expect(filter).toHaveFocus())
  await user.click(screen.getByRole('link', { name: '상세 · ' + id }))
  await screen.findByRole('heading', { level: 1, name: '문제 신고 상세' })
  await act(async () => {
    await router.navigate(-1)
  })
  await waitFor(() =>
    expect(screen.getByRole('link', { name: '상세 · ' + id })).toHaveFocus()
  )
})
it('disables stale-row targets and previous/next while a new page is only placeholder data', async () => {
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor())
  let finish!: (value: typeof one) => void
  const first = {
    ...one,
    items: Array.from({ length: 20 }, (_, index) => ({
      ...summary,
      id: `10000000-0000-4000-8000-${String(1000 - index).padStart(12, '0')}`
    })),
    total: 21
  }
  vi.spyOn(api, 'requestContentOperation')
    .mockResolvedValueOnce(first)
    .mockImplementation(
      () =>
        new Promise<typeof one>((resolve) => {
          finish = resolve
        })
    )
  route()
  await screen.findByRole('link', { name: '상세 · ' + first.items[0]!.id })
  await userEvent.click(screen.getByRole('button', { name: '다음 목록' }))
  await waitFor(() => {
    const links = screen.getAllByRole('link', { name: /^상세 ·/ })
    expect(links).toHaveLength(20)
    for (const link of links)
      expect(link).toHaveAttribute('aria-disabled', 'true')
  })
  expect(screen.getByRole('button', { name: '이전 목록' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '다음 목록' })).toBeDisabled()
  await act(async () => {
    finish({ ...one, page: 2, total: 21 })
  })
  expect(
    await screen.findByRole('link', { name: '상세 · ' + id })
  ).toBeVisible()
})
it('retains cached rows offline while locking targets and changing locale live', async () => {
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor())
  vi.spyOn(api, 'requestContentOperation').mockResolvedValue(one)
  route()
  await screen.findByRole('link', { name: '상세 · ' + id })
  await act(async () => {
    onlineManager.setOnline(false)
  })
  expect(screen.getByRole('link', { name: '상세 · ' + id })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  expect(
    within(screen.getByRole('list', { name: '문제 신고 큐' })).getByText('기타')
  ).toBeVisible()
  await userEvent.selectOptions(
    screen.getAllByRole('combobox', { name: '언어' })[0]!,
    'ja'
  )
  expect(
    await screen.findByRole('heading', { level: 1, name: '問題報告キュー' })
  ).toBeVisible()
})

it('preserves returned row focus through passive refetch and offline while blocking activation', async () => {
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor())
  const endpoint = vi
    .spyOn(api, 'requestContentOperation')
    .mockImplementation(async (request) =>
      request.operation === 'getAdminQuestionReport' ? detail : one
    )
  const router = route('/admin/reports?reason=OTHER&page=1')
  const user = userEvent.setup()
  await user.click(await screen.findByRole('link', { name: '상세 · ' + id }))
  await screen.findByRole('heading', { level: 1, name: '문제 신고 상세' })
  await user.click(screen.getByRole('link', { name: '신고 목록으로' }))
  const returned = await screen.findByRole('link', { name: '상세 · ' + id })
  await waitFor(() => expect(returned).toHaveFocus())
  const location = router.state.location
  let finish!: (value: typeof one) => void
  endpoint.mockImplementation(
    () =>
      new Promise<typeof one>((resolve) => {
        finish = resolve
      })
  )
  let refresh!: Promise<void>
  await act(async () => {
    refresh = client.invalidateQueries({
      queryKey: ['admin-content', 'reports']
    })
  })
  await waitFor(() =>
    expect(screen.getByRole('link', { name: '상세 · ' + id })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  )
  expect(screen.getByRole('link', { name: '상세 · ' + id })).toBe(returned)
  expect(returned).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(fireEvent.click(returned, { ctrlKey: true })).toBe(false)
  expect(
    fireEvent(
      returned,
      new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })
    )
  ).toBe(false)
  expect(fireEvent.contextMenu(returned)).toBe(false)
  expect(router.state.location).toBe(location)
  await act(async () => {
    finish(one)
    await refresh
  })
  await waitFor(() => expect(returned).not.toHaveAttribute('aria-disabled'))
  expect(returned).toHaveFocus()
  endpoint.mockResolvedValue(one)
  await act(async () => {
    onlineManager.setOnline(false)
  })
  expect(returned).toHaveAttribute('aria-disabled', 'true')
  expect(returned).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(router.state.location).toBe(location)
  await act(async () => {
    onlineManager.setOnline(true)
  })
  await waitFor(() => expect(returned).not.toHaveAttribute('aria-disabled'))
  expect(returned).toHaveFocus()
  const filter = screen.getByRole('combobox', { name: '처리 상태' })
  await user.click(filter)
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['admin-content', 'reports'] })
  })
  expect(filter).toHaveFocus()
})

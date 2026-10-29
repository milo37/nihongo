import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  encodePhase7OccurredAtCursor,
  type AdminAuditLogItem,
  type ListAdminAuditLogResponse
} from '@nihongo/contracts/admin/phase7'
import { appDocumentNavigation } from '@nihongo/browser/libs/appNavigation'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import * as listApi from '@nihongo/browser/api/admin-question/listAdminQuestion/index'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { useAppStore } from '@nihongo/browser/store/index'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import * as authApi from '@nihongo/browser/api/auth/getCurrentUser/index'
import * as phase7Api from '@nihongo/browser/api/content-operations/requestContentOperation'
import { adminRoutes } from '@/router'
import { actorId } from '@app/admin-question/test/questionFixture'

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
  localStorage.clear()
  vi.restoreAllMocks()
})
const actor = (role: 'USER' | 'ADMIN') => ({
  id: actorId,
  name: '테스트 사용자',
  email: 'fixture@example.test',
  role,
  targetLevel: 'N3' as const
})
const renderRoute = (entry = '/admin/audit-log') => {
  const router = createMemoryRouter(adminRoutes, {
    basename: '/admin',
    initialEntries: [entry]
  })
  const view = render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
  return { router, container: view.container }
}

it('registers the audit route for ADMIN in the existing real-only shell', async () => {
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor('ADMIN'))
  const read = vi
    .spyOn(phase7Api, 'requestContentOperation')
    .mockResolvedValue({
      items: [],
      nextCursor: null
    })
  const { router } = renderRoute()
  expect(
    await screen.findByRole('heading', { level: 1, name: '관리자 감사 기록' })
  ).toBeVisible()
  expect(
    await screen.findByRole('heading', { name: '감사 기록이 없습니다' })
  ).toBeVisible()
  expect(read).toHaveBeenCalledWith({
    operation: 'listAdminAuditLog',
    params: {},
    query: { limit: 50 },
    body: undefined
  })
  expect(router.state.location.pathname).toBe('/admin/audit-log')
})

const auditItem = (id: string): AdminAuditLogItem => ({
  id,
  command: 'QUESTION_VERSION_UPDATE',
  targetType: 'QUESTION_VERSION',
  targetId: '10000000-0000-4000-8000-000000000020',
  actor: { kind: 'ACCOUNT', actorId, role: 'ADMIN', label: 'ACTIVE_ADMIN' },
  beforeState: 'DRAFT',
  afterState: 'DRAFT',
  beforeRowVersion: 1,
  afterRowVersion: 2,
  changedFields: ['QUESTION_TEXT'],
  metadata: { kind: 'NONE_V1' },
  contentDigest: '0'.repeat(64),
  operationId: id,
  requestId: 'fixture-request',
  environment: 'TEST',
  occurredAt: '2026-10-25T00:00:00.000Z'
})
const firstItem: AdminAuditLogItem = {
  ...auditItem('10000000-0000-4000-8000-000000000021'),
  environment: 'PRODUCTION'
}
const secondItem: AdminAuditLogItem = {
  ...auditItem('10000000-0000-4000-8000-000000000022'),
  occurredAt: '2026-10-24T00:00:00.000Z'
}
const cursor = encodePhase7OccurredAtCursor({
  occurredAt: firstItem.occurredAt,
  id: firstItem.id
})
const firstPage: ListAdminAuditLogResponse = {
  items: [firstItem],
  nextCursor: cursor
}
const lastPage: ListAdminAuditLogResponse = {
  items: [secondItem],
  nextCursor: null
}
const emptyPage: ListAdminAuditLogResponse = { items: [], nextCursor: null }
const authAdmin = () =>
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor('ADMIN'))
const auditList = () => screen.getByRole('list', { name: '관리자 감사 기록' })

it('distinguishes loading from an empty response and focuses the empty result', async () => {
  authAdmin()
  let finish!: (response: ListAdminAuditLogResponse) => void
  vi.spyOn(phase7Api, 'requestContentOperation').mockImplementation(
    () =>
      new Promise<ListAdminAuditLogResponse>((resolve) => {
        finish = resolve
      })
  )
  renderRoute()
  expect(
    await screen.findByText('감사 기록을 불러오는 중입니다…')
  ).toBeVisible()
  expect(screen.queryByText('감사 기록이 없습니다')).not.toBeInTheDocument()
  await act(async () => finish(emptyPage))
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: '감사 기록이 없습니다' })
    ).toHaveFocus()
  )
})

it('presents a bounded error and supports keyboard retry with focus restoration', async () => {
  authAdmin()
  const user = userEvent.setup()
  const read = vi
    .spyOn(phase7Api, 'requestContentOperation')
    .mockRejectedValueOnce(
      Object.assign(new Error('PRIVATE_SERVER_DETAIL'), {
        code: 'SERVICE_UNAVAILABLE',
        retryAfterMs: 5000
      })
    )
    .mockResolvedValue(emptyPage)
  renderRoute()
  const error = await screen.findByRole('heading', {
    name: '감사 기록을 불러오지 못했습니다.'
  })
  await waitFor(() => expect(error).toHaveFocus())
  expect(
    screen.getByText(/관리자 기능을 잠시 사용할 수 없습니다/)
  ).toHaveTextContent('5초 뒤 다시 시도')
  expect(screen.queryByText(/PRIVATE_SERVER_DETAIL/)).not.toBeInTheDocument()
  screen.getByRole('button', { name: '감사 기록 다시 확인' }).focus()
  await user.keyboard('{Enter}')
  await screen.findByRole('heading', { name: '감사 기록이 없습니다' })
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { level: 1, name: '관리자 감사 기록' })
    ).toHaveFocus()
  )
  expect(read).toHaveBeenCalledTimes(2)
})

it('loads the exact cursor by keyboard and focuses the first appended safe record', async () => {
  authAdmin()
  const user = userEvent.setup()
  const read = vi
    .spyOn(phase7Api, 'requestContentOperation')
    .mockResolvedValueOnce(firstPage)
    .mockResolvedValueOnce(lastPage)
  const { container } = renderRoute()
  await screen.findByRole('list', { name: '관리자 감사 기록' })
  expect(within(auditList()).getAllByRole('listitem')).toHaveLength(1)
  expect(container.querySelector('form,input,[download]')).toBeNull()
  const more = screen.getByRole('button', { name: '이전 감사 기록 더 보기' })
  more.focus()
  await user.keyboard('{Enter}')
  await waitFor(() =>
    expect(within(auditList()).getAllByRole('listitem')).toHaveLength(2)
  )
  expect(read).toHaveBeenLastCalledWith({
    operation: 'listAdminAuditLog',
    params: {},
    query: { limit: 50, cursor },
    body: undefined
  })
  expect(
    screen.queryByRole('button', { name: '이전 감사 기록 더 보기' })
  ).not.toBeInTheDocument()
  expect(within(auditList()).getAllByRole('listitem')[1]).toHaveFocus()
  expect(container.querySelector('time')).toHaveAttribute(
    'dateTime',
    firstItem.occurredAt
  )
  expect(
    screen.getByText('요청 fixture-request · 환경 운영')
  ).toBeInTheDocument()
  expect(screen.queryByText(firstItem.contentDigest)).not.toBeInTheDocument()
  expect(screen.queryByText('NONE_V1')).not.toBeInTheDocument()
})

it('preserves cached records after a failed next page and lets recovery unlock more', async () => {
  authAdmin()
  const user = userEvent.setup()
  vi.spyOn(phase7Api, 'requestContentOperation')
    .mockResolvedValueOnce(firstPage)
    .mockRejectedValueOnce(
      Object.assign(new Error('not shown'), { code: 'SERVICE_UNAVAILABLE' })
    )
    .mockResolvedValueOnce(firstPage)
    .mockResolvedValueOnce(lastPage)
  renderRoute()
  await screen.findByRole('list', { name: '관리자 감사 기록' })
  await user.click(
    screen.getByRole('button', { name: '이전 감사 기록 더 보기' })
  )
  expect(
    await screen.findByText(
      '최신 감사 기록을 확인하지 못했습니다. 현재 기록은 그대로 유지됩니다.'
    )
  ).toBeVisible()
  expect(within(auditList()).getAllByRole('listitem')).toHaveLength(1)
  expect(
    screen.getByRole('button', { name: '이전 감사 기록 더 보기' })
  ).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '감사 기록 다시 확인' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '이전 감사 기록 더 보기' })
    ).toBeEnabled()
  )
  await user.click(
    screen.getByRole('button', { name: '이전 감사 기록 더 보기' })
  )
  await waitFor(() =>
    expect(within(auditList()).getAllByRole('listitem')).toHaveLength(2)
  )
})

it.each(['GUEST', 'USER'] as const)(
  'blocks %s before any audit query',
  async (role) => {
    vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(
      role === 'GUEST' ? null : actor('USER')
    )
    const read = vi.spyOn(phase7Api, 'requestContentOperation')
    const replace = vi
      .spyOn(appDocumentNavigation, 'replace')
      .mockImplementation(() => undefined)
    renderRoute()
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        role === 'GUEST'
          ? '/login?redirect=%2Fadmin%2Faudit-log'
          : '/forbidden',
        undefined
      )
    )
    expect(read).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('heading', { name: '관리자 감사 기록' })
    ).not.toBeInTheDocument()
  }
)

it('uses the existing Japanese locale without changing the route', async () => {
  authAdmin()
  expect(writeUiLocalePreference('ja')).toBe(true)
  vi.spyOn(phase7Api, 'requestContentOperation').mockResolvedValue(emptyPage)
  const { router } = renderRoute()
  expect(
    await screen.findByRole('heading', { level: 1, name: '管理者監査ログ' })
  ).toBeVisible()
  expect(
    await screen.findByRole('heading', { name: '監査ログがありません' })
  ).toBeVisible()
  expect(router.state.location.pathname).toBe('/admin/audit-log')
  const user = userEvent.setup()
  await user.selectOptions(
    screen.getAllByRole('combobox', { name: '言語' })[0]!,
    'ko'
  )
  expect(
    await screen.findByRole('heading', { level: 1, name: '관리자 감사 기록' })
  ).toBeVisible()
})

it('retains cached audit content while offline and blocks fetching another page', async () => {
  authAdmin()
  const read = vi
    .spyOn(phase7Api, 'requestContentOperation')
    .mockResolvedValue(firstPage)
  renderRoute()
  await screen.findByRole('list', { name: '관리자 감사 기록' })
  await act(async () => {
    onlineManager.setOnline(false)
    void client.invalidateQueries({ queryKey: ['phase7-admin', 'audit-log'] })
  })
  expect(
    await screen.findByText(/오프라인이라 최신 상태를 확인하지 못했습니다/)
  ).toBeVisible()
  expect(within(auditList()).getAllByRole('listitem')).toHaveLength(1)
  expect(
    screen.getByRole('button', { name: '이전 감사 기록 더 보기' })
  ).toBeDisabled()
  expect(read).toHaveBeenCalledTimes(1)
})

it('connects existing question navigation to audit and preserves filters on Back', async () => {
  authAdmin()
  const user = userEvent.setup()
  vi.spyOn(listApi, 'listAdminQuestion').mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0
  })
  vi.spyOn(phase7Api, 'requestContentOperation').mockResolvedValue(emptyPage)
  const { router } = renderRoute('/admin/questions?level=N3&page=1')
  await screen.findByRole('heading', { level: 1, name: '문제 관리' })
  const nav = screen.getByRole('navigation', { name: '현재 위치' })
  const auditLink = within(nav).getByRole('link', { name: '감사 기록' })
  expect(auditLink).toHaveAttribute('href', '/admin/audit-log')
  auditLink.focus()
  await user.keyboard('{Enter}')
  await screen.findByRole('heading', { level: 1, name: '관리자 감사 기록' })
  expect(
    within(screen.getByRole('navigation', { name: '현재 위치' })).getByRole(
      'link',
      { name: '감사 기록' }
    )
  ).toHaveAttribute('aria-current', 'page')
  await act(async () => router.navigate(-1))
  await screen.findByRole('heading', { level: 1, name: '문제 관리' })
  expect(router.state.location.pathname + router.state.location.search).toBe(
    '/admin/questions?level=N3&page=1'
  )
})

it('focus lifecycle: reconnect growth after More does not steal focus from navigation', async () => {
  authAdmin()
  const user = userEvent.setup()
  const newer = {
    ...auditItem('10000000-0000-4000-8000-000000000023'),
    occurredAt: '2026-10-26T00:00:00.000Z'
  }
  const read = vi
    .spyOn(phase7Api, 'requestContentOperation')
    .mockResolvedValueOnce(firstPage)
    .mockResolvedValueOnce(lastPage)
    .mockResolvedValueOnce({ items: [newer, firstItem], nextCursor: cursor })
    .mockResolvedValueOnce(lastPage)
  renderRoute()
  await screen.findByRole('list', { name: '관리자 감사 기록' })
  const more = screen.getByRole('button', { name: '이전 감사 기록 더 보기' })
  more.focus()
  await user.keyboard('{Enter}')
  await waitFor(() =>
    expect(within(auditList()).getAllByRole('listitem')).toHaveLength(2)
  )
  expect(within(auditList()).getAllByRole('listitem')[1]).toHaveFocus()
  const navigation = screen.getByRole('navigation', { name: '현재 위치' })
  const questions = within(navigation).getByRole('link', { name: '문제 관리' })
  questions.focus()
  expect(questions).toHaveFocus()
  await act(async () => {
    onlineManager.setOnline(false)
    await client.invalidateQueries({
      queryKey: ['phase7-admin', 'audit-log'],
      refetchType: 'none'
    })
    onlineManager.setOnline(true)
  })
  await waitFor(() => expect(read).toHaveBeenCalledTimes(4))
  await waitFor(() =>
    expect(within(auditList()).getAllByRole('listitem')).toHaveLength(3)
  )
  expect(questions).toHaveFocus()
})

it('focus lifecycle: paused cached-success retry restores the heading when reconnect completes', async () => {
  authAdmin()
  const user = userEvent.setup()
  const read = vi
    .spyOn(phase7Api, 'requestContentOperation')
    .mockResolvedValue(firstPage)
  renderRoute()
  await screen.findByRole('list', { name: '관리자 감사 기록' })
  const statuses: string[] = []
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (
      event.query.queryKey[0] === 'phase7-admin' &&
      event.query.queryKey[1] === 'audit-log'
    )
      statuses.push(event.query.state.status)
  })
  try {
    await act(async () => {
      onlineManager.setOnline(false)
      void client.invalidateQueries({ queryKey: ['phase7-admin', 'audit-log'] })
    })
    expect(
      await screen.findByText(/오프라인이라 최신 상태를 확인하지 못했습니다/)
    ).toBeVisible()
    expect(within(auditList()).getAllByRole('listitem')).toHaveLength(1)
    const retry = screen.getByRole('button', { name: '감사 기록 다시 확인' })
    retry.focus()
    await user.keyboard('{Enter}')
    expect(retry).toHaveFocus()
    await act(async () => onlineManager.setOnline(true))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: '감사 기록 다시 확인' })
      ).not.toBeInTheDocument()
    )
    expect(statuses.length).toBeGreaterThan(0)
    expect(statuses.every((status) => status === 'success')).toBe(true)
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: '관리자 감사 기록' })
      ).toHaveFocus()
    )
  } finally {
    unsubscribe()
  }
})

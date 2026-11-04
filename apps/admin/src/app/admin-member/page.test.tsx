import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type {
  AdminMemberDetail,
  AdminMemberSummary
} from '@nihongo/contracts/admin/members'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { useAppStore } from '@nihongo/browser/store/index'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import * as authApi from '@nihongo/browser/api/auth/getCurrentUser/index'
import * as memberApi from '@nihongo/browser/api/admin-member/index'
import { adminRoutes } from '@/router'
import { actorId } from '@app/admin-question/test/questionFixture'

const memberId = '30000000-0000-4000-8000-000000000001'
const summary: AdminMemberSummary = {
  memberId,
  maskedEmail: 'le***@example.test',
  joinedAt: '2026-10-01T00:00:00.000Z',
  lastStudiedAt: null,
  solvedCount: 12,
  reportCount: 1,
  status: 'ACTIVE',
  rowVersion: 3
}
const detail: AdminMemberDetail = {
  ...summary,
  restrictedAt: null,
  restrictionReason: null
}

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  invalidateCanonicalAuthTransitions()
  useAppStore.getState().setCurrentUser(null)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue({
    id: actorId,
    name: '관리자',
    role: 'ADMIN',
    targetLevel: 'N3',
    adminSessionExpiresAt: '2099-01-01T00:00:00.000Z',
    adminFreshUntil: null
  })
})
afterEach(() => {
  cleanup()
  client.clear()
  writeUiLocalePreference('ko')
  localStorage.clear()
  vi.restoreAllMocks()
})

const renderRoute = (entry: string) => {
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

it('lists members in the grid and sends server sort and page parameters', async () => {
  const list = vi.spyOn(memberApi, 'listAdminMembers').mockResolvedValue({
    items: [summary],
    page: 1,
    pageSize: 25,
    total: 1
  })
  const router = renderRoute('/admin/members')
  const grid = await screen.findByRole('table', { name: '가입자 목록' })
  expect(within(grid).getByText('le***@example.test')).toBeVisible()
  expect(within(grid).getByText('학습 기록 없음')).toBeVisible()
  expect(within(grid).getByText('이용 중')).toBeVisible()
  expect(list).toHaveBeenLastCalledWith({
    sort: 'joinedAt',
    order: 'desc',
    page: 1,
    pageSize: 25
  })

  await userEvent.click(within(grid).getByRole('button', { name: '푼 문제' }))
  expect(router.state.location.search).toContain('sort=solvedCount')
  expect(list).toHaveBeenLastCalledWith(
    expect.objectContaining({ sort: 'solvedCount' })
  )
})

it('searches by exact email and rejects a malformed address locally', async () => {
  const list = vi.spyOn(memberApi, 'listAdminMembers').mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0
  })
  renderRoute('/admin/members')
  const field = await screen.findByLabelText('이메일로 찾기')
  await userEvent.type(field, 'not-an-email')
  await userEvent.click(screen.getByRole('button', { name: '찾기' }))
  expect(screen.getByText('올바른 이메일 주소를 입력해 주세요.')).toBeVisible()

  await userEvent.clear(field)
  await userEvent.type(field, ' Learner@Example.test ')
  await userEvent.click(screen.getByRole('button', { name: '찾기' }))
  expect(
    await screen.findByText('이 이메일로 가입한 사람이 없습니다.')
  ).toBeVisible()
  expect(list).toHaveBeenLastCalledWith(
    expect.objectContaining({ email: 'learner@example.test' })
  )
})

it('confirms a restriction and keeps the reason through an in-page re-check when fresh assurance is required', async () => {
  vi.spyOn(memberApi, 'getAdminMember').mockResolvedValue(detail)
  const restrict = vi
    .spyOn(memberApi, 'restrictAdminMember')
    .mockRejectedValueOnce(
      Object.assign(new Error('fresh'), {
        code: 'FRESH_ASSURANCE_REQUIRED',
        status: 401
      })
    )
  renderRoute(`/admin/members/${memberId}`)
  await screen.findByRole('heading', { level: 1, name: '가입자 상세' })

  await userEvent.click(
    await screen.findByRole('button', { name: '이용 제한' })
  )
  expect(screen.getByText('제한 사유를 1~500자로 적어 주세요.')).toBeVisible()
  expect(restrict).not.toHaveBeenCalled()

  await userEvent.type(screen.getByLabelText('제한 사유'), '반복 스팸 제보')
  await userEvent.click(screen.getByRole('button', { name: '이용 제한' }))
  const dialog = await screen.findByRole('dialog', {
    name: '이용을 제한할까요?'
  })
  expect(within(dialog).getByText('le***@example.test')).toBeVisible()
  expect(restrict).not.toHaveBeenCalled()
  await userEvent.click(
    within(dialog).getByRole('button', { name: '제한 적용' })
  )
  expect(restrict).toHaveBeenCalledWith(memberId, {
    expectedRowVersion: 3,
    reason: '반복 스팸 제보'
  })

  const alert = await screen.findByRole('alert')
  const confirm = within(alert).getByRole('button', { name: '확인 완료' })
  await waitFor(() => expect(confirm).toHaveFocus())
  const link = within(alert).getByRole('link', { name: '새 탭에서 본인 확인' })
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute(
    'href',
    `/login?redirect=${encodeURIComponent(`/admin/members/${memberId}`)}`
  )

  // Same admin without a recent ADMIN_FRESH sign-in is not confirmed.
  await userEvent.click(confirm)
  expect(
    await screen.findByText('본인 확인이 끝나지 않아 적용하지 않았습니다.')
  ).toBeVisible()
  await waitFor(() => expect(confirm).toHaveFocus())

  vi.mocked(authApi.getCurrentUser).mockResolvedValue({
    id: actorId,
    name: '관리자',
    role: 'ADMIN',
    targetLevel: 'N3',
    adminSessionExpiresAt: '2099-01-01T00:00:00.000Z',
    adminFreshUntil: new Date(Date.now() + 5 * 60_000).toISOString()
  })
  await userEvent.click(confirm)
  const confirmed = await screen.findByText(
    '본인 확인을 마쳤습니다. ‘이용 제한’ 버튼을 다시 눌러 적용해 주세요.'
  )
  await waitFor(() => expect(confirmed).toHaveFocus())
  expect(screen.getByLabelText('제한 사유')).toHaveValue('반복 스팸 제보')
})

it('releases a restricted member and moves focus to the new section heading', async () => {
  vi.spyOn(memberApi, 'getAdminMember')
    .mockResolvedValueOnce({
      ...detail,
      status: 'RESTRICTED',
      restrictedAt: '2026-11-01T00:00:00.000Z',
      restrictionReason: '스팸'
    })
    .mockResolvedValue({ ...detail, rowVersion: 5 })
  const release = vi
    .spyOn(memberApi, 'releaseAdminMemberRestriction')
    .mockResolvedValue({ ...detail, rowVersion: 5 })
  renderRoute(`/admin/members/${memberId}`)
  expect(await screen.findByText('스팸')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '제한 해제' }))
  expect(release).toHaveBeenCalledWith(memberId, { expectedRowVersion: 3 })
  const heading = await screen.findByRole('heading', {
    level: 2,
    name: '이용 제한'
  })
  await waitFor(() => expect(heading).toHaveFocus())
})

it('shows the first 8 characters of the member id in the list', async () => {
  vi.spyOn(memberApi, 'listAdminMembers').mockResolvedValue({
    items: [summary],
    page: 1,
    pageSize: 25,
    total: 1
  })
  renderRoute('/admin/members')
  const link = await screen.findByRole('link', { name: memberId })
  expect(link).toHaveTextContent(/^30000000…$/u)
  expect(link).toHaveAttribute('title', memberId)
})

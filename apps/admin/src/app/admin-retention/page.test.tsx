import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { GetAdminRetentionResponse } from '@nihongo/contracts/admin/retention'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { useAppStore } from '@nihongo/browser/store/index'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import * as authApi from '@nihongo/browser/api/auth/getCurrentUser/index'
import * as retentionApi from '@nihongo/browser/api/admin-retention/index'
import { adminRoutes } from '@/router'
import { preloadAdminPages } from '@/test/preloadAdminPages'
import { actorId } from '@app/admin-question/test/questionFixture'

beforeAll(preloadAdminPages)

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

const renderRoute = () => {
  const router = createMemoryRouter(adminRoutes, {
    basename: '/admin',
    initialEntries: ['/admin/retention']
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
}

const response: GetAdminRetentionResponse = {
  rows: [
    {
      cohortDate: '2026-11-22',
      audience: 'MEMBER',
      cohortSize: 8,
      day1Returned: 2,
      weekCohortSize: null,
      day7Returned: null,
      week1Returned: null
    },
    {
      cohortDate: '2026-11-10',
      audience: 'GUEST',
      cohortSize: 40,
      day1Returned: 10,
      weekCohortSize: 40,
      day7Returned: 6,
      week1Returned: 12
    },
    {
      cohortDate: '2026-11-09',
      audience: 'MEMBER',
      cohortSize: 0,
      day1Returned: 0,
      weekCohortSize: 0,
      day7Returned: 0,
      week1Returned: 0
    }
  ]
}

it('shows each cohort day with counts, shares and not-yet-counted cells', async () => {
  vi.spyOn(retentionApi, 'getAdminRetention').mockResolvedValue(response)
  renderRoute()
  const table = await screen.findByRole('table', { name: '일별 재방문율' })
  const rows = within(table).getAllByRole('row')
  expect(rows).toHaveLength(4)
  const [recent, guest, empty] = rows.slice(1)
  expect(within(recent!).getByText('2026-11-22')).toBeVisible()
  expect(within(recent!).getByText('회원')).toBeVisible()
  expect(within(recent!).getByText('25%')).toBeVisible()
  expect(within(recent!).getAllByText('집계 전')).toHaveLength(2)
  expect(within(guest!).getByText('비회원')).toBeVisible()
  expect(within(guest!).getByText('15%')).toBeVisible()
  expect(within(guest!).getByText('30%')).toBeVisible()
  expect(within(empty!).getAllByText('없음').length).toBeGreaterThan(0)
})

it('says so when nothing is counted yet and when loading fails', async () => {
  const read = vi
    .spyOn(retentionApi, 'getAdminRetention')
    .mockResolvedValue({ rows: [] })
  renderRoute()
  expect(await screen.findByText('아직 집계된 날이 없습니다')).toBeVisible()
  cleanup()
  client.clear()
  read.mockRejectedValue(new Error('down'))
  renderRoute()
  expect(
    await screen.findByText('재방문율을 불러오지 못했습니다.')
  ).toBeVisible()
})

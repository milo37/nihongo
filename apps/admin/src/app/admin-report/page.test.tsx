import {
  QueryClient,
  QueryClientProvider,
  onlineManager
} from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { adminRoutes } from '@/router'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import * as authApi from '@nihongo/browser/api/auth/getCurrentUser/index'
import * as reportApi from '@nihongo/browser/api/admin-report/index'
import { useAppStore } from '@nihongo/browser/store/index'
import {
  adminActor,
  reportDetail,
  reportId,
  reportSummary
} from '@app/admin-report/test/reportFixture'

const renderAdmin = (client: QueryClient, entry: string) => {
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

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  invalidateCanonicalAuthTransitions()
  useAppStore.getState().setCurrentUser(null)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(adminActor())
})
afterEach(() => {
  cleanup()
  client.clear()
  onlineManager.setOnline(true)
  writeUiLocalePreference('ko')
  vi.restoreAllMocks()
})

const page = (items = [reportSummary()], total = items.length) => ({
  items,
  page: 1,
  pageSize: 25,
  total
})

it('lists unified reports with status, kind, preview, location and a detail link', async () => {
  const list = vi.spyOn(reportApi, 'listAdminReports').mockResolvedValue(page())
  renderAdmin(client, '/admin/reports')
  const items = await screen.findByRole('list', { name: '버그 리포트' })
  const row = within(items).getAllByRole('listitem')[0]!
  expect(within(row).getByText('접수됨')).toBeVisible()
  expect(within(row).getByText('문항 신고')).toBeVisible()
  expect(
    within(row).getByText(/정답이 두 개처럼 보여요/u, { selector: 'p' })
  ).toBeVisible()
  expect(within(row).getByText('result#2')).toBeVisible()
  expect(within(row).getByRole('link', { name: /상세 보기/u })).toHaveAttribute(
    'href',
    `/admin/reports/${reportId}`
  )
  expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 25 })
  expect(screen.getByText('제보 1건')).toBeVisible()
})

it('applies status, kind and page size filters through the URL', async () => {
  const list = vi.spyOn(reportApi, 'listAdminReports').mockResolvedValue(page())
  const router = renderAdmin(client, '/admin/reports')
  await screen.findByRole('list', { name: '버그 리포트' })
  const user = userEvent.setup()
  await user.selectOptions(screen.getByLabelText('처리 상태'), 'ANSWERED')
  await user.selectOptions(screen.getByLabelText('유형'), 'APP_ERROR')
  await user.selectOptions(screen.getByLabelText('페이지당 개수'), '50')
  await user.click(screen.getByRole('button', { name: '필터 적용' }))
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 50,
      status: 'ANSWERED',
      kind: 'APP_ERROR'
    })
  )
  expect(router.state.location.search).toBe(
    '?status=ANSWERED&kind=APP_ERROR&page=1&pageSize=50'
  )
})

it('shows the design empty state when there is nothing to handle', async () => {
  vi.spyOn(reportApi, 'listAdminReports').mockResolvedValue(page([], 0))
  renderAdmin(client, '/admin/reports')
  expect(await screen.findByText('처리할 제보가 없습니다.')).toBeVisible()
})

it('falls back to safe defaults for unsupported URL filters', async () => {
  const list = vi.spyOn(reportApi, 'listAdminReports').mockResolvedValue(page())
  renderAdmin(client, '/admin/reports?status=OPEN&pageSize=30')
  expect(
    await screen.findByText(
      'URL 검색 조건이 허용 범위를 벗어났습니다. 기본 조건을 사용합니다.'
    )
  ).toBeVisible()
  expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 25 })
})

it('keeps the list and offers retry when a refresh fails', async () => {
  vi.spyOn(reportApi, 'listAdminReports').mockRejectedValue({
    code: 'SERVICE_UNAVAILABLE',
    status: 503
  })
  renderAdmin(client, '/admin/reports')
  expect(
    await screen.findByRole('button', { name: '제보 목록 다시 확인' })
  ).toBeVisible()
  expect(screen.getByText('제보 목록을 불러오지 못했습니다.')).toBeVisible()
})

it('pages through results using the selected page size', async () => {
  const list = vi.spyOn(reportApi, 'listAdminReports').mockResolvedValue(
    page(
      [
        reportSummary(
          reportDetail({
            status: 'CLOSED',
            kind: 'APP_ERROR',
            questionId: null,
            questionVersionId: null,
            location: 'dashboard'
          })
        )
      ],
      30
    )
  )
  renderAdmin(client, '/admin/reports')
  const next = await screen.findByRole('button', { name: '다음 페이지' })
  await waitFor(() => expect(next).toBeEnabled())
  await userEvent.click(next)
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith({ page: 2, pageSize: 25 })
  )
})

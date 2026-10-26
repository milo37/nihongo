import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { appDocumentNavigation } from '@nihongo/browser/libs/appNavigation'
import { useAppStore } from '@nihongo/browser/store/index'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import * as authApi from '@nihongo/browser/api/auth/getCurrentUser/index'
import * as listApi from '@nihongo/browser/api/admin-question/listAdminQuestion/index'
import { adminRoutes } from '@/router'
import { question, actorId } from '@app/admin-question/test/questionFixture'

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  invalidateCanonicalAuthTransitions()
  useAppStore.getState().setCurrentUser(null)
})
afterEach(() => {
  cleanup()
  client.clear()
  vi.restoreAllMocks()
})
const renderRoutes = () => {
  const router = createMemoryRouter(adminRoutes, {
    basename: '/admin',
    initialEntries: ['/admin/questions?level=N3&page=1']
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
const actor = (role: 'USER' | 'ADMIN') => ({
  id: actorId,
  name: '테스트 사용자',
  email: 'fixture@example.test',
  role,
  targetLevel: 'N3' as const
})
it('GUEST goes to the public login document and preserves the admin URL/filter', async () => {
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(null)
  const replace = vi
    .spyOn(appDocumentNavigation, 'replace')
    .mockImplementation(() => undefined)
  renderRoutes()
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(
      '/login?redirect=%2Fadmin%2Fquestions%3Flevel%3DN3%26page%3D1',
      undefined
    )
  )
  expect(
    screen.queryByRole('heading', { name: '문제 관리' })
  ).not.toBeInTheDocument()
})
it('USER is rejected before an admin list request', async () => {
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor('USER'))
  const list = vi.spyOn(listApi, 'listAdminQuestion')
  const replace = vi
    .spyOn(appDocumentNavigation, 'replace')
    .mockImplementation(() => undefined)
  renderRoutes()
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith('/forbidden', undefined)
  )
  expect(list).not.toHaveBeenCalled()
})
it('ADMIN loads the existing table at the /admin basename with the local create/edit paths', async () => {
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor('ADMIN'))
  vi.spyOn(listApi, 'listAdminQuestion').mockResolvedValue({
    items: [question],
    total: 1,
    page: 1,
    pageSize: 20
  })
  const router = renderRoutes()
  expect(
    await screen.findByRole('heading', { name: '문제 관리' })
  ).toBeVisible()
  const region = await screen.findByRole('region', { name: '관리자 문제 목록' })
  expect(region).toHaveAttribute('tabindex', '0')
  expect(
    within(region).getByRole('table', { name: /JLPT 관리자 문제 목록/ })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: question.questionId + ' 문제 수정' })
  ).toHaveAttribute(
    'href',
    '/admin/questions/' +
      question.questionId +
      '/edit?returnTo=%2Fadmin%2Fquestions%3Flevel%3DN3%26page%3D1'
  )
  expect(router.state.location.pathname + router.state.location.search).toBe(
    '/admin/questions?level=N3&page=1'
  )
})

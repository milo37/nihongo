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
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import { useAppStore } from '@nihongo/browser/store/index'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import * as authApi from '@nihongo/browser/api/auth/getCurrentUser/index'
import * as listApi from '@api/admin-question/listAdminQuestion/index'
import type { ListAdminQuestionRequest } from '@api/admin-question/listAdminQuestion/schema'
import * as api from '@nihongo/browser/api/content-operations/requestContentOperation'
import { adminRoutes } from '@/router'
import { preloadAdminPages } from '@/test/preloadAdminPages'
import { actorId, question } from '@app/admin-question/test/questionFixture'

beforeAll(preloadAdminPages)

const id = (n: number, kind: string) =>
  `10000000-0000-4000-8${kind}00-${String(n).padStart(12, '0')}`
const published = (n: number) => ({
  ...question,
  questionId: id(n, '1'),
  selectedVersionId: id(n, '2'),
  currentPublishedVersionId: id(n, '2'),
  openCandidateVersionId: null,
  versionStatus: 'PUBLISHED' as const,
  versionRowVersion: 4,
  level: 'N5' as const,
  subject: 'VOCABULARY' as const
})

/** Published N5 vocabulary questions the retire dialog will count. */
let publishedCount = 2
let client: QueryClient
beforeEach(() => {
  publishedCount = 2
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
  vi.spyOn(listApi, 'listAdminQuestion').mockImplementation(
    async (params: ListAdminQuestionRequest = {}) => {
      if (params.versionStatus !== 'PUBLISHED')
        return { items: [question], total: 1, page: 1, pageSize: 20 }
      const page = Number(params.page ?? 1)
      const start = (page - 1) * 100
      const items = Array.from(
        { length: Math.max(0, Math.min(100, publishedCount - start)) },
        (_, index) => published(start + index + 1)
      )
      return { items, total: publishedCount, page, pageSize: 100 }
    }
  )
})
afterEach(() => {
  cleanup()
  client.clear()
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

const retireOk = () =>
  vi.spyOn(api, 'requestContentOperation').mockImplementation(async (input) => {
    const items = (
      input.body as { items: { questionVersionId: string }[] }
    ).items.map(({ questionVersionId }) => ({
      questionId: questionVersionId,
      questionVersionId,
      questionRowVersion: 5,
      rowVersion: 5
    }))
    return { retiredCount: items.length, items } as never
  })

const openDialog = async (
  entry = '/admin/questions?level=N5&subject=VOCABULARY'
) => {
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
  await userEvent.click(
    await screen.findByRole('button', { name: '급수·과목별 한꺼번에 비공개' })
  )
  return screen.getByRole('dialog', { name: '급수·과목별로 한꺼번에 비공개' })
}

it('starts from the list filters, counts the published questions and retires them', async () => {
  const retire = retireOk()
  const dialog = await openDialog()
  expect(within(dialog).getByLabelText('급수')).toHaveValue('N5')
  expect(within(dialog).getByLabelText('과목')).toHaveValue('VOCABULARY')
  expect(
    await within(dialog).findByText(
      'N5 문자·어휘에서 공개 중인 문제 2개를 비공개로 바꿉니다.'
    )
  ).toBeVisible()
  await userEvent.click(
    within(dialog).getByRole('button', { name: '2개 비공개' })
  )

  const heading = await screen.findByRole('heading', {
    name: 'N5 문자·어휘 문제 2개를 비공개로 바꿨습니다.'
  })
  await waitFor(() => expect(heading).toHaveFocus())
  expect(retire).toHaveBeenCalledTimes(1)
  expect(retire.mock.calls[0]?.[0]).toMatchObject({
    operation: 'retireQuestionVersionBatch',
    body: {
      items: [
        { questionVersionId: id(1, '2'), expectedRowVersion: 4 },
        { questionVersionId: id(2, '2'), expectedRowVersion: 4 }
      ]
    }
  })
})

it('asks for a level and subject first, and cannot confirm an empty group', async () => {
  publishedCount = 0
  const dialog = await openDialog('/admin/questions')
  const confirm = within(dialog).getByRole('button', { name: '0개 비공개' })
  expect(confirm).toBeDisabled()
  expect(
    within(dialog).getByText('급수와 과목을 고르면 대상 개수를 보여 드립니다.')
  ).toBeVisible()
  await userEvent.selectOptions(within(dialog).getByLabelText('급수'), 'N5')
  await userEvent.selectOptions(
    within(dialog).getByLabelText('과목'),
    'VOCABULARY'
  )
  expect(
    await within(dialog).findByText('N5 문자·어휘에 공개 중인 문제가 없습니다.')
  ).toBeVisible()
  expect(confirm).toBeDisabled()
})

it('sends 100 at a time and reports where it stopped', async () => {
  publishedCount = 150
  const retire = retireOk()
  retire.mockImplementationOnce(
    async () =>
      ({
        retiredCount: 100,
        items: Array.from({ length: 100 }, (_, index) => ({
          questionId: id(index + 1, '1'),
          questionVersionId: id(index + 1, '2'),
          questionRowVersion: 5,
          rowVersion: 5
        }))
      }) as never
  )
  retire.mockRejectedValueOnce(
    Object.assign(new Error('conflict'), {
      code: 'VERSION_CONFLICT',
      status: 409
    })
  )
  const dialog = await openDialog()
  await userEvent.click(
    await within(dialog).findByRole('button', { name: '150개 비공개' })
  )
  expect(
    await screen.findByRole('heading', {
      name: '100개를 비공개로 바꾸고 멈췄습니다. 남은 50개는 그대로 공개 중입니다. 목록을 새로 본 뒤 다시 시도해 주세요.'
    })
  ).toBeVisible()
  expect(retire).toHaveBeenCalledTimes(2)
  const sizes = retire.mock.calls.map(
    ([input]) => (input.body as { items: unknown[] }).items.length
  )
  expect(sizes).toEqual([100, 50])
})

it('keeps the dialog and asks for re-verification when assurance ran out', async () => {
  vi.spyOn(api, 'requestContentOperation').mockRejectedValue(
    Object.assign(new Error('fresh'), {
      code: 'FRESH_ASSURANCE_REQUIRED',
      status: 401
    })
  )
  const dialog = await openDialog()
  await userEvent.click(
    await within(dialog).findByRole('button', { name: '2개 비공개' })
  )
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    '2개 비공개'
  )
  expect(
    screen.queryByRole('heading', { name: /비공개로 바꿨습니다/ })
  ).toBeNull()
})

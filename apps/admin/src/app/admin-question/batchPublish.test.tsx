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
import * as api from '@nihongo/browser/api/content-operations/requestContentOperation'
import { adminRoutes } from '@/router'
import { preloadAdminPages } from '@/test/preloadAdminPages'
import { actorId, question } from '@app/admin-question/test/questionFixture'

beforeAll(preloadAdminPages)

const approvedId = '10000000-0000-4000-8000-0000000000a1'
const approvedVersion = '10000000-0000-4000-8000-0000000000a2'
const secondId = '10000000-0000-4000-8000-0000000000b1'
const secondVersion = '10000000-0000-4000-8000-0000000000b2'
const approved = (questionId: string, versionId: string) => ({
  ...question,
  questionId,
  selectedVersionId: versionId,
  openCandidateVersionId: versionId,
  versionStatus: 'APPROVED' as const,
  versionRowVersion: 3,
  latestReviewer: question.author
})

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
  // Server order: updatedAt desc, then questionId desc.
  vi.spyOn(listApi, 'listAdminQuestion').mockResolvedValue({
    items: [
      approved(secondId, secondVersion),
      approved(approvedId, approvedVersion),
      question
    ],
    total: 3,
    page: 1,
    pageSize: 20
  })
})
afterEach(() => {
  cleanup()
  client.clear()
  localStorage.clear()
  vi.restoreAllMocks()
})

const selectAll = async () => {
  const router = createMemoryRouter(adminRoutes, {
    basename: '/admin',
    initialEntries: ['/admin/questions']
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
    await screen.findByRole('checkbox', {
      name: '이 페이지의 승인된 문제 모두 선택'
    })
  )
  expect(
    screen.queryByRole('checkbox', {
      name: `${question.questionId} 문제 선택`
    })
  ).toBeNull()
  expect(screen.getByText('2개 선택됨')).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: '선택한 문제 공개' })
  )
  return { dialog: screen.getByRole('dialog'), router }
}

it('publishes only approved rows and lists failed items with focus on the result', async () => {
  const publish = vi.spyOn(api, 'requestContentOperation').mockResolvedValue({
    publishedCount: 1,
    items: [
      {
        questionVersionId: secondVersion,
        result: 'FAILED',
        rowVersion: null
      },
      {
        questionVersionId: approvedVersion,
        result: 'PUBLISHED',
        rowVersion: 4
      }
    ]
  })
  const { dialog } = await selectAll()
  expect(
    within(dialog).getByRole('heading', { name: '문제 2개를 공개할까요?' })
  ).toBeVisible()
  await userEvent.click(
    within(dialog).getByRole('button', { name: '2개 공개' })
  )

  const heading = await screen.findByRole('heading', {
    name: '1개 공개, 1개는 공개하지 못했습니다'
  })
  await waitFor(() => expect(heading).toHaveFocus())
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(publish).toHaveBeenCalledWith({
    operation: 'publishQuestionVersionBatch',
    params: {},
    query: {},
    body: {
      items: [
        { questionVersionId: secondVersion, expectedRowVersion: 3 },
        { questionVersionId: approvedVersion, expectedRowVersion: 3 }
      ]
    }
  })
  const resultArea = within(heading.closest('section')!)
  expect(resultArea.getByRole('link', { name: secondId })).toBeVisible()
  expect(resultArea.queryByRole('link', { name: approvedId })).toBeNull()
  expect(
    screen.getByText(
      '공개 중 문제가 생겼습니다. 다시 시도하기 전에 목록에서 상태를 확인해 주세요.'
    )
  ).toBeVisible()
  expect(screen.queryByText('2개 선택됨')).toBeNull()
})

it('keeps the dialog and selection on fresh assurance and never resends by itself', async () => {
  const publish = vi.spyOn(api, 'requestContentOperation').mockRejectedValue(
    Object.assign(new Error('fresh'), {
      code: 'FRESH_ASSURANCE_REQUIRED',
      status: 401
    })
  )
  const { dialog } = await selectAll()
  await userEvent.click(
    within(dialog).getByRole('button', { name: '2개 공개' })
  )

  expect(
    await within(dialog).findByRole('link', { name: '새 탭에서 본인 확인' })
  ).toBeVisible()
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: '확인 완료' })
    ).toHaveFocus()
  )
  expect(screen.getByText('2개 선택됨')).toBeVisible()
  expect(publish).toHaveBeenCalledTimes(1)

  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue({
    id: actorId,
    name: '관리자',
    role: 'ADMIN',
    targetLevel: 'N3',
    adminSessionExpiresAt: '2099-01-01T00:00:00.000Z',
    adminFreshUntil: '2099-01-01T00:00:00.000Z'
  })
  await userEvent.click(
    within(dialog).getByRole('button', { name: '확인 완료' })
  )
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: '2개 공개' })
    ).toHaveFocus()
  )
  expect(publish).toHaveBeenCalledTimes(1)
})

it('keeps focus while publishing and moves it to a whole-request failure', async () => {
  let fail: (error: unknown) => void = () => undefined
  vi.spyOn(api, 'requestContentOperation').mockReturnValue(
    new Promise((_resolve, reject) => {
      fail = reject
    })
  )
  const { dialog } = await selectAll()
  await userEvent.click(
    within(dialog).getByRole('button', { name: '2개 공개' })
  )

  const pending = await within(dialog).findByRole('button', {
    name: '공개 중…'
  })
  expect(pending).toHaveFocus()
  expect(pending).toHaveAttribute('aria-disabled', 'true')
  fail(
    Object.assign(new Error('server'), {
      code: 'INTERNAL_SERVER_ERROR',
      status: 500
    })
  )
  const alert = await within(dialog).findByRole('alert')
  expect(alert).toHaveTextContent(/공개하지 않았습니다\.$/)
  await waitFor(() => expect(alert).toHaveFocus())
})

it('clears the selection when the page or filter changes, even after coming back', async () => {
  const { dialog, router } = await selectAll()
  await userEvent.click(within(dialog).getByRole('button', { name: '취소' }))
  await router.navigate('/questions?level=N3')
  await waitFor(() => expect(screen.queryByText('2개 선택됨')).toBeNull())

  await router.navigate('/questions')
  expect(
    await screen.findByRole('checkbox', {
      name: '이 페이지의 승인된 문제 모두 선택'
    })
  ).not.toBeChecked()
  expect(screen.queryByText('2개 선택됨')).toBeNull()
})

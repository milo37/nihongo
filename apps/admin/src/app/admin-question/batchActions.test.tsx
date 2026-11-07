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

// Someone else's draft: only its author may request review, so no checkbox.
const othersDraft = {
  ...question,
  author: {
    kind: 'ACCOUNT' as const,
    actorId: '10000000-0000-4000-8000-0000000000ff',
    role: 'ADMIN' as const,
    label: 'ACTIVE_ADMIN' as const
  }
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
  // Server order: updatedAt desc, then questionId desc.
  vi.spyOn(listApi, 'listAdminQuestion').mockResolvedValue({
    items: [
      approved(secondId, secondVersion),
      approved(approvedId, approvedVersion),
      othersDraft
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
      name: '이 페이지에서 고를 수 있는 문제 모두 선택'
    })
  )
  expect(
    screen.queryByRole('checkbox', {
      name: `${question.questionId} 문제 선택`
    })
  ).toBeNull()
  expect(screen.getByText('2개 선택됨')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '승인된 2개 공개' }))
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
      name: '이 페이지에서 고를 수 있는 문제 모두 선택'
    })
  ).not.toBeChecked()
  expect(screen.queryByText('2개 선택됨')).toBeNull()
})

it('approves only in-review rows from the same selection and lists failures', async () => {
  const reviewId = '10000000-0000-4000-8000-0000000000c1'
  const reviewVersion = '10000000-0000-4000-8000-0000000000c2'
  const failedReviewId = '10000000-0000-4000-8000-0000000000d1'
  const failedReviewVersion = '10000000-0000-4000-8000-0000000000d2'
  const inReview = (questionId: string, versionId: string) => ({
    ...approved(questionId, versionId),
    versionStatus: 'IN_REVIEW' as const,
    versionRowVersion: 5
  })
  vi.spyOn(listApi, 'listAdminQuestion').mockResolvedValue({
    items: [
      inReview(failedReviewId, failedReviewVersion),
      inReview(reviewId, reviewVersion),
      approved(approvedId, approvedVersion),
      othersDraft
    ],
    total: 4,
    page: 1,
    pageSize: 20
  })
  const approve = vi.spyOn(api, 'requestContentOperation').mockResolvedValue({
    approvedCount: 1,
    items: [
      {
        questionVersionId: failedReviewVersion,
        result: 'NOT_IN_REVIEW',
        rowVersion: null
      },
      { questionVersionId: reviewVersion, result: 'APPROVED', rowVersion: 6 }
    ]
  })
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
      name: '이 페이지에서 고를 수 있는 문제 모두 선택'
    })
  )
  expect(screen.getByText('3개 선택됨')).toBeVisible()
  expect(screen.getByRole('button', { name: '승인된 1개 공개' })).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: '검수 중 2개 승인' })
  )
  const dialog = screen.getByRole('dialog')
  expect(
    within(dialog).getByRole('heading', { name: '문제 2개를 승인할까요?' })
  ).toBeVisible()
  await userEvent.click(
    within(dialog).getByRole('button', { name: '2개 승인' })
  )

  const heading = await screen.findByRole('heading', {
    name: '1개 승인, 1개는 승인하지 못했습니다'
  })
  await waitFor(() => expect(heading).toHaveFocus())
  expect(approve).toHaveBeenCalledExactlyOnceWith({
    operation: 'approveQuestionVersionBatch',
    params: {},
    query: {},
    body: {
      items: [
        { questionVersionId: failedReviewVersion, expectedRowVersion: 5 },
        { questionVersionId: reviewVersion, expectedRowVersion: 5 }
      ]
    }
  })
  const resultArea = within(heading.closest('section')!)
  expect(resultArea.getByRole('link', { name: failedReviewId })).toBeVisible()
  expect(resultArea.getByText('검수 중 아님')).toBeVisible()
  expect(resultArea.queryByRole('link', { name: reviewId })).toBeNull()
  expect(screen.queryByText('3개 선택됨')).toBeNull()
})

it('loads 100 rows per page when chosen so one batch can take a full page', async () => {
  const list = vi.mocked(listApi.listAdminQuestion)
  await selectAll()
  await userEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(list).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 1, pageSize: 20 })
  )
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: '한 페이지에' }),
    '100'
  )
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, pageSize: 100 })
    )
  )
})

it('shows a rate limit wait in minutes and says the admin check is needed again', async () => {
  vi.spyOn(api, 'requestContentOperation').mockRejectedValue(
    Object.assign(new Error('limited'), {
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterMs: 900_000
    })
  )
  const { dialog } = await selectAll()
  await userEvent.click(
    within(dialog).getByRole('button', { name: '2개 공개' })
  )
  const alert = await within(dialog).findByRole('alert')
  expect(alert).toHaveTextContent('15분 뒤 다시 시도해 주세요.')
  expect(alert).not.toHaveTextContent('900')
  expect(alert).toHaveTextContent(
    '기다린 뒤 다시 보낼 때는 관리자 본인 확인을 다시 해야 합니다.'
  )
})

it('requests review of own drafts 20 at a time and marks a refused chunk', async () => {
  const draft = (index: number) => {
    const suffix = index.toString(16).padStart(4, '0')
    return {
      ...question,
      questionId: `20000000-0000-4000-8000-00000000${suffix}`,
      selectedVersionId: `20000000-0000-4000-8000-10000000${suffix}`,
      openCandidateVersionId: `20000000-0000-4000-8000-10000000${suffix}`,
      versionRowVersion: 2
    }
  }
  const drafts = Array.from({ length: 25 }, (_, index) => draft(25 - index))
  vi.spyOn(listApi, 'listAdminQuestion').mockResolvedValue({
    items: [...drafts, approved(approvedId, approvedVersion), othersDraft],
    total: 27,
    page: 1,
    pageSize: 100
  })
  const request = vi
    .spyOn(api, 'requestContentOperation')
    .mockResolvedValueOnce({ items: [] })
    .mockRejectedValueOnce(
      Object.assign(new Error('conflict'), {
        code: 'VERSION_CONFLICT',
        status: 409
      })
    )
  const router = createMemoryRouter(adminRoutes, {
    basename: '/admin',
    initialEntries: ['/admin/questions?pageSize=100']
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
      name: '이 페이지에서 고를 수 있는 문제 모두 선택'
    })
  )
  expect(screen.getByText('26개 선택됨')).toBeVisible()
  expect(screen.getByRole('button', { name: '승인된 1개 공개' })).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: '내 초안 25개 검수 요청' })
  )
  const dialog = screen.getByRole('dialog')
  expect(
    within(dialog).getByRole('heading', {
      name: '문제 25개를 검수 요청할까요?'
    })
  ).toBeVisible()
  await userEvent.click(
    within(dialog).getByRole('button', { name: '25개 검수 요청' })
  )

  const heading = await screen.findByRole('heading', {
    name: '20개 검수 요청, 5개는 요청하지 못했습니다'
  })
  await waitFor(() => expect(heading).toHaveFocus())
  const sent = (from: number, to: number) => ({
    operation: 'requestContentReviewBatch',
    params: {},
    query: {},
    body: {
      items: drafts.slice(from, to).map((row) => ({
        versionId: row.selectedVersionId,
        expectedRowVersion: 2
      }))
    }
  })
  expect(request).toHaveBeenCalledTimes(2)
  expect(request).toHaveBeenNthCalledWith(1, sent(0, 20))
  expect(request).toHaveBeenNthCalledWith(2, sent(20, 25))
  const resultArea = within(heading.closest('section')!)
  expect(resultArea.getAllByText('변경 충돌')).toHaveLength(5)
  expect(
    resultArea.getByRole('link', { name: drafts[24]!.questionId })
  ).toBeVisible()
  expect(
    resultArea.queryByRole('link', { name: drafts[0]!.questionId })
  ).toBeNull()
})

it('stops sending review requests at the rate limit after a chunk went through', async () => {
  const drafts = Array.from({ length: 41 }, (_, index) => {
    const suffix = (41 - index).toString(16).padStart(4, '0')
    return {
      ...question,
      questionId: `30000000-0000-4000-8000-00000000${suffix}`,
      selectedVersionId: `30000000-0000-4000-8000-10000000${suffix}`,
      openCandidateVersionId: `30000000-0000-4000-8000-10000000${suffix}`
    }
  })
  vi.spyOn(listApi, 'listAdminQuestion').mockResolvedValue({
    items: drafts,
    total: 41,
    page: 1,
    pageSize: 100
  })
  const request = vi
    .spyOn(api, 'requestContentOperation')
    .mockResolvedValueOnce({ items: [] })
    .mockRejectedValueOnce(
      Object.assign(new Error('limited'), {
        code: 'RATE_LIMITED',
        status: 429,
        retryAfterMs: 900_000
      })
    )
  const router = createMemoryRouter(adminRoutes, {
    basename: '/admin',
    initialEntries: ['/admin/questions?pageSize=100']
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
      name: '이 페이지에서 고를 수 있는 문제 모두 선택'
    })
  )
  await userEvent.click(
    screen.getByRole('button', { name: '내 초안 41개 검수 요청' })
  )
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: '41개 검수 요청'
    })
  )
  const heading = await screen.findByRole('heading', {
    name: '20개 검수 요청, 21개는 요청하지 못했습니다'
  })
  expect(request).toHaveBeenCalledTimes(2)
  expect(
    within(heading.closest('section')!).getAllByText('보내지 않음')
  ).toHaveLength(21)
})

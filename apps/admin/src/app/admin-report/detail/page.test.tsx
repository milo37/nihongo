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
import { preloadAdminPages } from '@/test/preloadAdminPages'
import { invalidateCanonicalAuthTransitions } from '@nihongo/browser/app/login/authSession'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import * as authApi from '@nihongo/browser/api/auth/getCurrentUser/index'
import * as reportApi from '@nihongo/browser/api/admin-report/index'
import { useAppStore } from '@nihongo/browser/store/index'
import {
  adminActor,
  questionId,
  reportDetail,
  reportId
} from '@app/admin-report/test/reportFixture'

beforeAll(preloadAdminPages)

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

const open = async (detail = reportDetail()) => {
  const get = vi.spyOn(reportApi, 'getAdminReport').mockResolvedValue(detail)
  renderAdmin(client, `/admin/reports/${reportId}`)
  await screen.findByRole('heading', { name: '정답이 두 개처럼 보여요' })
  return { get }
}
const process = () => screen.getByRole('region', { name: '처리' })

it('shows the content card, location, target question and process panel', async () => {
  await open()
  expect(screen.getByText('문항 신고')).toBeVisible()
  const status = screen.getByText('접수됨')
  expect(status).toHaveClass('bg-warning-soft')
  expect(status.querySelector('svg')).not.toBeNull()
  expect(screen.getByText('문항 신고')).not.toHaveClass('bg-warning-soft')
  expect(screen.getByText('result#2')).toBeVisible()
  expect(screen.getByRole('link', { name: questionId })).toHaveAttribute(
    'href',
    `/admin/questions/${questionId}`
  )
  expect(screen.getByText(/8f2c41aa…/u)).toBeVisible()
  expect(
    within(process()).getByLabelText('제보자에게 보낼 답변')
  ).toHaveAccessibleDescription(/제보자가 ‘내 제보’에서 봅니다/u)
  expect(
    within(process()).getByLabelText('내부 메모')
  ).toHaveAccessibleDescription(/제보자에게 보이지 않습니다/u)
  // Both fields match the contract's 1,000-character cap.
  for (const label of ['제보자에게 보낼 답변', '내부 메모'])
    expect(within(process()).getByLabelText(label)).toHaveAttribute(
      'maxLength',
      '1000'
    )
  expect(
    screen.getByRole('link', { name: '대상 문항 새 버전 만들기' })
  ).toHaveAttribute('href', `/admin/questions/${questionId}/edit`)
})

it('replies and closes with the current row version and the optional note', async () => {
  await open()
  const send = vi
    .spyOn(reportApi, 'replyAndCloseAdminReport')
    .mockResolvedValue(
      reportDetail({
        status: 'ANSWERED',
        reporterReply: '해설에 추가했습니다.',
        repliedAt: '2026-11-02T00:30:00Z',
        closedAt: '2026-11-02T00:30:00Z',
        rowVersion: 2
      })
    )
  const user = userEvent.setup()
  await user.type(
    within(process()).getByLabelText('제보자에게 보낼 답변'),
    '해설에 추가했습니다.'
  )
  await user.type(within(process()).getByLabelText('내부 메모'), '새 버전 예정')
  await user.click(
    within(process()).getByRole('button', { name: '답변하고 종결' })
  )
  expect(send).toHaveBeenCalledWith(reportId, {
    expectedRowVersion: 1,
    reporterReply: '해설에 추가했습니다.',
    internalNote: '새 버전 예정'
  })
  // Success is a toast (E1-7), not text in the panel; focus goes to the
  // panel heading because the form it came from is gone.
  expect(await screen.findByText('답변을 보내고 종결했습니다.')).toBeVisible()
  expect(
    within(process()).queryByText('답변을 보내고 종결했습니다.')
  ).toBeNull()
  await waitFor(() =>
    expect(
      within(process()).getByRole('heading', { name: '처리' })
    ).toHaveFocus()
  )
})

it('requires a reply before replying and closing', async () => {
  await open()
  const send = vi.spyOn(reportApi, 'replyAndCloseAdminReport')
  const user = userEvent.setup()
  await user.click(
    within(process()).getByRole('button', { name: '답변하고 종결' })
  )
  expect(
    await screen.findByText('제보자에게 보낼 답변을 입력해 주세요.')
  ).toBeVisible()
  expect(within(process()).getByLabelText('제보자에게 보낼 답변')).toHaveFocus()
  expect(send).not.toHaveBeenCalled()
})

it('saves only the internal note and closes without a reply', async () => {
  await open(reportDetail({ internalNote: '기존 메모' }))
  const note = vi
    .spyOn(reportApi, 'saveAdminReportNote')
    .mockResolvedValue(reportDetail({ internalNote: '기존 메모 추가' }))
  const close = vi
    .spyOn(reportApi, 'closeAdminReport')
    .mockResolvedValue(reportDetail({ status: 'CLOSED', rowVersion: 2 }))
  expect(screen.getByText('내부 메모 · 제보자에게 안 보임')).toBeVisible()
  const user = userEvent.setup()
  const memo = within(process()).getByLabelText('내부 메모')
  expect(memo).toHaveValue('기존 메모')
  await user.type(memo, ' 추가')
  await user.click(
    within(process()).getByRole('button', { name: '메모만 저장' })
  )
  expect(note).toHaveBeenCalledWith(reportId, {
    expectedRowVersion: 1,
    internalNote: '기존 메모 추가'
  })
  expect(await screen.findByText('내부 메모를 저장했습니다.')).toBeVisible()
  await user.click(
    within(process()).getByRole('button', { name: '답변 없이 종결' })
  )
  expect(close).toHaveBeenCalledWith(reportId, {
    expectedRowVersion: 1,
    internalNote: '기존 메모 추가'
  })
})

it('after a conflict shows the latest memo, keeps my draft aside and never overwrites silently', async () => {
  const get = vi
    .spyOn(reportApi, 'getAdminReport')
    .mockResolvedValueOnce(reportDetail())
    .mockResolvedValue(
      reportDetail({ internalNote: '다른 관리자 메모', rowVersion: 2 })
    )
  renderAdmin(client, `/admin/reports/${reportId}`)
  await screen.findByRole('heading', { name: '정답이 두 개처럼 보여요' })
  vi.spyOn(reportApi, 'replyAndCloseAdminReport').mockRejectedValueOnce({
    code: 'VERSION_CONFLICT',
    status: 409
  })
  const user = userEvent.setup()
  const reply = within(process()).getByLabelText('제보자에게 보낼 답변')
  const memo = within(process()).getByLabelText('내부 메모')
  await user.type(reply, '확인했습니다.')
  await user.type(memo, '내 초안 메모')
  await user.click(
    within(process()).getByRole('button', { name: '답변하고 종결' })
  )
  expect(
    await screen.findByText(/다른 관리자가 먼저 이 제보를 바꿨습니다/u)
  ).toHaveAttribute('role', 'alert')
  await waitFor(() => expect(memo).toHaveValue('다른 관리자 메모'))
  expect(get.mock.calls.length).toBeGreaterThan(1)
  expect(reply).toHaveValue('확인했습니다.')
  expect(screen.getByText('내 초안 메모')).toBeVisible()
  const save = vi
    .spyOn(reportApi, 'saveAdminReportNote')
    .mockResolvedValue(reportDetail({ rowVersion: 3 }))
  await user.click(
    within(process()).getByRole('button', { name: '메모만 저장' })
  )
  expect(save).toHaveBeenLastCalledWith(reportId, {
    expectedRowVersion: 2,
    internalNote: '다른 관리자 메모'
  })
})

it('restores my draft into the memo field only when I ask', async () => {
  vi.spyOn(reportApi, 'getAdminReport')
    .mockResolvedValueOnce(reportDetail())
    .mockResolvedValue(
      reportDetail({ internalNote: '다른 관리자 메모', rowVersion: 2 })
    )
  renderAdmin(client, `/admin/reports/${reportId}`)
  await screen.findByRole('heading', { name: '정답이 두 개처럼 보여요' })
  vi.spyOn(reportApi, 'saveAdminReportNote').mockRejectedValueOnce({
    code: 'VERSION_CONFLICT',
    status: 409
  })
  const user = userEvent.setup()
  const memo = within(process()).getByLabelText('내부 메모')
  await user.type(memo, '내 초안 메모')
  await user.click(
    within(process()).getByRole('button', { name: '메모만 저장' })
  )
  await waitFor(() => expect(memo).toHaveValue('다른 관리자 메모'))
  // The conflict alert takes focus on the next frame, before any user click.
  await waitFor(() =>
    expect(within(process()).getByRole('alert')).toHaveFocus()
  )
  await user.click(
    within(process()).getByRole('button', { name: '내 메모 다시 넣기' })
  )
  expect(memo).toHaveValue('내 초안 메모')
  expect(memo).toHaveFocus()
})

it('shows a closed report as read-only with the sent reply', async () => {
  await open(
    reportDetail({
      status: 'ANSWERED',
      reporterReply: '해설을 고쳤습니다.',
      repliedAt: '2026-11-02T00:30:00Z',
      closedAt: '2026-11-02T00:30:00Z',
      rowVersion: 2
    })
  )
  expect(screen.getByText('보낸 답변')).toBeVisible()
  expect(screen.getByText('해설을 고쳤습니다.')).toBeVisible()
  expect(screen.getByText('종결된 제보는 더 처리할 수 없습니다.')).toBeVisible()
  expect(
    within(process()).queryByRole('button', { name: '답변하고 종결' })
  ).toBeNull()
})

it('shows an app error report without question links', async () => {
  await open(
    reportDetail({
      kind: 'APP_ERROR',
      location: 'dashboard',
      questionId: null,
      questionVersionId: null,
      reporterMemberId: null
    })
  )
  expect(screen.getByText('앱 오류')).toBeVisible()
  expect(screen.getByText(/탈퇴한 회원/u)).toBeVisible()
  expect(screen.queryByText('대상 문항')).toBeNull()
  expect(
    screen.queryByRole('link', { name: '대상 문항 새 버전 만들기' })
  ).toBeNull()
})

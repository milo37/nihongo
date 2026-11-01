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
  waitFor
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import {
  questionReportDetailSchema,
  questionReportMutationResultSchema,
  type QuestionReportDetail
} from '@nihongo/contracts/admin/content-operations'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { ToastProvider } from '@nihongo/browser/common/components/Toast'
import {
  commitCanonicalAuth,
  invalidateCanonicalAuthTransitions
} from '@nihongo/browser/app/login/authSession'
import { appDocumentNavigation } from '@nihongo/browser/libs/appNavigation'
import { cachedSessionStorage } from '@nihongo/browser/libs/storage'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { useAppStore } from '@nihongo/browser/store/index'
import * as authApi from '@nihongo/browser/api/auth/getCurrentUser/index'
import * as api from '@nihongo/browser/api/content-operations/requestContentOperation'
import {
  discardReportDraft,
  restoreReportDraft,
  saveReportDraft,
  saveReportContext
} from '@app/admin-report/navigation/reportDraftRecovery'
import { adminRoutes } from '@/router'

// Compile the existing lazy detail route before timed DOM assertions.
beforeAll(async () => {
  await import('@app/admin-report/detail/page')
})

const actorId = '10000000-0000-4000-8000-000000000001'
const id = '10000000-0000-4000-8000-000000000002'
const otherId = '10000000-0000-4000-8000-000000000003'
const actor = (value = actorId) => ({
  id: value,
  name: '관리자',
  role: 'ADMIN' as const,
  targetLevel: 'N3' as const
})
const initial = questionReportDetailSchema.parse({
  id,
  questionId: actorId,
  questionVersionId: actorId,
  reason: 'OTHER',
  status: 'TRIAGED',
  rowVersion: 2,
  reporter: { kind: 'ACCOUNT', actorId, role: 'USER', label: 'ACTIVE_USER' },
  assignee: { kind: 'ACCOUNT', actorId, role: 'ADMIN', label: 'ACTIVE_ADMIN' },
  description: '<script>ordinary text</script>',
  descriptionDigest: '0'.repeat(64),
  resolution: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z'
})
let client: QueryClient
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  invalidateCanonicalAuthTransitions()
  useAppStore.getState().setCurrentUser(null)
  discardReportDraft(actorId, id)
  discardReportDraft(otherId, id)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  vi.spyOn(authApi, 'getCurrentUser').mockResolvedValue(actor())
})
afterEach(() => {
  cleanup()
  client.clear()
  onlineManager.setOnline(true)
  writeUiLocalePreference('ko')
  vi.restoreAllMocks()
})
const route = (reportId = id) => {
  const router = createMemoryRouter(adminRoutes, {
    basename: '/admin',
    initialEntries: ['/admin/reports/' + reportId]
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
  return { ...view, router }
}
const reason = () => screen.getByRole('textbox', { name: '처리 사유' })
const submit = () => screen.getByRole('button', { name: '최종 처리 실행' })
const fill = async (text = '해설 확인') => {
  await screen.findByRole('textbox', { name: '처리 사유' })
  fireEvent.change(reason(), { target: { value: text } })
}
it('renders escaped detail text and target IDs without a non-existent question detail destination', async () => {
  vi.spyOn(api, 'requestContentOperation').mockResolvedValue(initial)
  const { container } = route()
  expect(
    await screen.findByText('<script>ordinary text</script>')
  ).toBeVisible()
  expect(container.querySelector('script')).toBeNull()
  expect(
    container.querySelector(`a[href='/admin/questions/${actorId}']`)
  ).toBeNull()
})
it('blocks invalid IDs before GET and renders not-found failures with no command controls', async () => {
  const read = vi
    .spyOn(api, 'requestContentOperation')
    .mockRejectedValue({ code: 'RESOURCE_NOT_FOUND' })
  const view = route('invalid')
  expect(
    await screen.findByText('요청 식별자 형식이 올바르지 않습니다.')
  ).toBeVisible()
  expect(read).not.toHaveBeenCalled()
  view.unmount()
  route()
  expect(
    await screen.findByText('요청한 관리자 자료를 찾을 수 없습니다.')
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: '최종 처리 실행' })
  ).not.toBeInTheDocument()
})
it('distinguishes loading from data and keeps failed cached detail and draft locked', async () => {
  let finish!: (value: QuestionReportDetail) => void
  const read = vi.spyOn(api, 'requestContentOperation').mockImplementation(
    () =>
      new Promise<QuestionReportDetail>((resolve) => {
        finish = resolve
      })
  )
  route()
  expect(
    await screen.findByText('신고 상세를 불러오는 중입니다…')
  ).toBeVisible()
  await act(async () => {
    finish(initial)
  })
  await fill()
  read.mockRejectedValue({ code: 'SERVICE_UNAVAILABLE' })
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['admin-content', 'reports'] })
  })
  expect(
    await screen.findByText(/최신 신고 상세를 확인하지 못했습니다/)
  ).toBeVisible()
  expect(reason()).toHaveValue('해설 확인')
  expect(submit()).toBeDisabled()
})
it('focuses invalid reason, counts 1000 Unicode scalars, and sends DISMISSED remediation null', async () => {
  const endpoint = vi
    .spyOn(api, 'requestContentOperation')
    .mockResolvedValue(initial)
  route()
  await fill('')
  const user = userEvent.setup()
  await user.click(submit())
  expect(reason()).toHaveFocus()
  await fill('😀'.repeat(1001))
  await user.click(submit())
  expect(
    endpoint.mock.calls.filter(
      ([r]) => r.operation === 'resolveAdminQuestionReport'
    )
  ).toHaveLength(0)
  await fill('😀'.repeat(1000))
  await user.selectOptions(
    screen.getByRole('combobox', { name: '처리 결과' }),
    'DISMISSED'
  )
  expect(
    screen.queryByRole('textbox', { name: '개선 버전 ID' })
  ).not.toBeInTheDocument()
  endpoint.mockImplementation(async (request) => {
    if (request.operation === 'resolveAdminQuestionReport')
      throw { code: 'INVALID_REQUEST' }
    return initial
  })
  await user.click(submit())
  await waitFor(() =>
    expect(endpoint).toHaveBeenCalledWith({
      operation: 'resolveAdminQuestionReport',
      params: { reportId: id },
      query: {},
      body: {
        expectedRowVersion: 2,
        outcome: 'DISMISSED',
        reason: '😀'.repeat(1000),
        remediationVersionId: null
      }
    })
  )
})
it('triages OPEN using the viewed CAS version then reads TRIAGED before enabling resolution', async () => {
  let current: QuestionReportDetail = {
    ...initial,
    status: 'OPEN',
    rowVersion: 1,
    assignee: null
  }
  const endpoint = vi
    .spyOn(api, 'requestContentOperation')
    .mockImplementation(async (request) => {
      if (request.operation === 'triageAdminQuestionReport') {
        current = initial
        return questionReportMutationResultSchema.parse({
          id,
          questionId: initial.questionId,
          questionVersionId: initial.questionVersionId,
          status: 'TRIAGED',
          rowVersion: 2,
          assignee: initial.assignee,
          resolution: null,
          createdAt: initial.createdAt,
          updatedAt: initial.updatedAt
        })
      }
      return current
    })
  route()
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: '신고 분류 시작' })
  )
  await screen.findByRole('textbox', { name: '처리 사유' })
  expect(endpoint).toHaveBeenCalledWith({
    operation: 'triageAdminQuestionReport',
    params: { reportId: id },
    query: {},
    body: { expectedRowVersion: 1 }
  })
  expect(
    screen.queryByRole('button', { name: '신고 분류 시작' })
  ).not.toBeInTheDocument()
})
it.each(['VERSION_CONFLICT', 'INVALID_STATE_TRANSITION'])(
  'retains %s input through failed refresh and requires successful fresh GET plus explicit retry with the new version',
  async (code) => {
    let current = initial
    let failRead = false
    let attempts = 0
    const endpoint = vi
      .spyOn(api, 'requestContentOperation')
      .mockImplementation(async (request) => {
        if (request.operation === 'resolveAdminQuestionReport') {
          attempts += 1
          throw { code: attempts === 1 ? code : 'INVALID_REQUEST' }
        }
        if (failRead) throw { code: 'SERVICE_UNAVAILABLE' }
        return current
      })
    route()
    await fill()
    const user = userEvent.setup()
    await user.click(submit())
    const conflictHeading = await screen.findByRole('heading', {
      name: '다른 작업에서 신고 상태가 변경됐습니다'
    })
    const reload = screen.getByRole('button', {
      name: '최신 신고 상태 불러오기'
    })
    expect(
      conflictHeading.compareDocumentPosition(reload) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      reload.compareDocumentPosition(reason()) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(reason()).toHaveValue('해설 확인')
    expect(reason()).toBeDisabled()
    expect(submit()).toBeDisabled()
    failRead = true
    await user.click(
      screen.getByRole('button', { name: '최신 신고 상태 불러오기' })
    )
    await screen.findByText(/최신 신고 상태를 확인하지 못했습니다/)
    expect(submit()).toBeDisabled()
    expect(attempts).toBe(1)
    failRead = false
    current = { ...initial, rowVersion: 3 }
    await user.click(
      screen.getByRole('button', { name: '최신 신고 상태 불러오기' })
    )
    await waitFor(() => expect(submit()).toBeEnabled())
    expect(
      screen.getByRole('heading', { name: '문제 신고 상세' })
    ).toHaveFocus()
    expect(reason()).toHaveValue('해설 확인')
    expect(attempts).toBe(1)
    await user.click(submit())
    await waitFor(() =>
      expect(
        endpoint.mock.calls
          .filter(([r]) => r.operation === 'resolveAdminQuestionReport')
          .at(-1)?.[0].body
      ).toMatchObject({ expectedRowVersion: 3 })
    )
  }
)
it('never navigates or replays on fresh failure; explicit Google entry saves only this report draft and bare callback', async () => {
  const endpoint = vi
    .spyOn(api, 'requestContentOperation')
    .mockImplementation(async (request) => {
      if (request.operation === 'resolveAdminQuestionReport')
        throw { code: 'FRESH_ASSURANCE_REQUIRED' }
      return initial
    })
  const assign = vi
    .spyOn(appDocumentNavigation, 'assign')
    .mockImplementation(() => undefined)
  const view = route()
  await fill()
  const user = userEvent.setup()
  await user.click(submit())
  await screen.findByRole('button', { name: 'Google로 관리자 본인 확인' })
  expect(assign).not.toHaveBeenCalled()
  expect(reason()).toHaveValue('해설 확인')
  await user.click(
    screen.getByRole('button', { name: 'Google로 관리자 본인 확인' })
  )
  expect(assign).toHaveBeenCalledWith(
    '/login?redirect=' + encodeURIComponent('/admin/reports/' + id)
  )
  expect(restoreReportDraft(actorId, id, 2)?.reason).toBe('해설 확인')
  expect(
    endpoint.mock.calls.filter(
      ([r]) => r.operation === 'resolveAdminQuestionReport'
    )
  ).toHaveLength(1)
  view.unmount()
  client.clear()
  invalidateCanonicalAuthTransitions()
  useAppStore.getState().setCurrentUser(null)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  route()
  await waitFor(() => expect(reason()).toHaveValue('해설 확인'))
  expect(
    endpoint.mock.calls.filter(
      ([request]) => request.operation === 'resolveAdminQuestionReport'
    )
  ).toHaveLength(1)
})
it('restores after a fresh document/auth epoch only for the same canonical actor, report, and rowVersion, with no command replay', async () => {
  saveReportDraft(actorId, id, 2, {
    outcome: 'DISMISSED',
    reason: '보관 초안',
    remediationVersionId: ''
  })
  saveReportContext(actorId, id, '/admin/reports?status=TRIAGED&page=3')
  invalidateCanonicalAuthTransitions()
  const endpoint = vi
    .spyOn(api, 'requestContentOperation')
    .mockResolvedValue(initial)
  route()
  await waitFor(() => expect(reason()).toHaveValue('보관 초안'))
  expect(screen.getByRole('link', { name: '신고 목록으로' })).toHaveAttribute(
    'href',
    expect.stringContaining('status=TRIAGED')
  )
  expect(
    endpoint.mock.calls.every(([r]) => r.operation === 'getAdminQuestionReport')
  ).toBe(true)
  expect(screen.getByRole('status')).toHaveTextContent(/처리 사유 초안을 복구/)
})
it('does not leave or lose input when draft storage fails before fresh navigation', async () => {
  vi.spyOn(api, 'requestContentOperation').mockImplementation(
    async (request) => {
      if (request.operation === 'resolveAdminQuestionReport')
        throw { code: 'FRESH_ASSURANCE_REQUIRED' }
      return initial
    }
  )
  const assign = vi
    .spyOn(appDocumentNavigation, 'assign')
    .mockImplementation(() => undefined)
  route()
  await fill()
  const user = userEvent.setup()
  await user.click(submit())
  await screen.findByRole('button', { name: 'Google로 관리자 본인 확인' })
  vi.spyOn(cachedSessionStorage, 'setItem').mockReturnValue(false)
  await user.click(
    screen.getByRole('button', { name: 'Google로 관리자 본인 확인' })
  )
  expect(assign).not.toHaveBeenCalled()
  expect(screen.getByText(/초안을 보관하지 못해/)).toBeVisible()
  expect(reason()).toHaveValue('해설 확인')
})
it('requires a dirty leave decision and preserves draft on stay, then discards explicitly', async () => {
  vi.spyOn(api, 'requestContentOperation').mockResolvedValue(initial)
  route()
  await fill()
  const user = userEvent.setup()
  await user.click(screen.getByRole('link', { name: '신고 목록으로' }))
  expect(
    await screen.findByRole('dialog', {
      name: '작성 중인 처리 사유가 있습니다'
    })
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: '계속 작성' }))
  expect(reason()).toHaveValue('해설 확인')
  await user.click(screen.getByRole('button', { name: '초안 버리기' }))
  expect(reason()).toHaveValue('')
})
it('locks offline commands and resets draft on canonical actor switch', async () => {
  const endpoint = vi
    .spyOn(api, 'requestContentOperation')
    .mockResolvedValue(initial)
  route()
  await fill()
  await act(async () => {
    onlineManager.setOnline(false)
  })
  expect(submit()).toBeDisabled()
  expect(reason()).toHaveValue('해설 확인')
  await act(async () => {
    onlineManager.setOnline(true)
    await commitCanonicalAuth(client, actor(otherId))
  })
  await waitFor(() => expect(reason()).toHaveValue(''))
  expect(
    endpoint.mock.calls.every(([r]) => r.operation === 'getAdminQuestionReport')
  ).toBe(true)
})
it('renders terminal resolution as read-only without command controls', async () => {
  vi.spyOn(api, 'requestContentOperation').mockResolvedValue({
    ...initial,
    status: 'DISMISSED',
    rowVersion: 3,
    resolution: {
      outcome: 'DISMISSED',
      reason: '검토 완료',
      remediationVersionId: null,
      resolvedAt: initial.updatedAt
    }
  })
  route()
  expect(await screen.findByText('검토 완료')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: '최종 처리 실행' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: '신고 분류 시작' })
  ).not.toBeInTheDocument()
})

it('focuses canonical server field errors without rendering server text', async () => {
  vi.spyOn(api, 'requestContentOperation').mockImplementation(
    async (request) => {
      if (request.operation === 'resolveAdminQuestionReport')
        throw {
          code: 'VALIDATION_ERROR',
          fieldErrors: { reason: ['SERVER_INTERNAL_CODE'] }
        }
      return initial
    }
  )
  route()
  await fill()
  await userEvent.click(submit())
  await waitFor(() => expect(reason()).toHaveFocus())
  expect(screen.getByText('이 입력값을 확인해 주세요.')).toBeVisible()
  expect(screen.queryByText('SERVER_INTERNAL_CODE')).not.toBeInTheDocument()
})

it('hands keyboard triage success to the stable heading once after canonical refetch', async () => {
  let current: QuestionReportDetail = {
    ...initial,
    status: 'OPEN',
    rowVersion: 1,
    assignee: null
  }
  vi.spyOn(api, 'requestContentOperation').mockImplementation(
    async (request) => {
      if (request.operation === 'triageAdminQuestionReport') {
        current = initial
        return questionReportMutationResultSchema.parse({
          id,
          questionId: initial.questionId,
          questionVersionId: initial.questionVersionId,
          status: 'TRIAGED',
          rowVersion: 2,
          assignee: initial.assignee,
          resolution: null,
          createdAt: initial.createdAt,
          updatedAt: initial.updatedAt
        })
      }
      return current
    }
  )
  route()
  const user = userEvent.setup()
  const button = await screen.findByRole('button', { name: '신고 분류 시작' })
  button.focus()
  await user.keyboard('{Enter}')
  await screen.findByRole('textbox', { name: '처리 사유' })
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { level: 1, name: '문제 신고 상세' })
    ).toHaveFocus()
  )
  const back = screen.getByRole('link', { name: '신고 목록으로' })
  back.focus()
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['admin-content', 'reports'] })
  })
  expect(back).toHaveFocus()
})

it.each(['RESOLVED', 'DISMISSED'] as const)(
  'hands keyboard resolution %s success to the stable heading after the form is removed',
  async (outcome) => {
    let current = initial
    const endpoint = vi
      .spyOn(api, 'requestContentOperation')
      .mockImplementation(async (request) => {
        if (request.operation === 'resolveAdminQuestionReport') {
          current = questionReportDetailSchema.parse({
            ...initial,
            status: outcome,
            rowVersion: 3,
            resolution: {
              outcome,
              reason: '처리 확인',
              remediationVersionId: null,
              resolvedAt: initial.updatedAt
            }
          })
          return questionReportMutationResultSchema.parse({
            id,
            questionId: current.questionId,
            questionVersionId: current.questionVersionId,
            status: outcome,
            rowVersion: 3,
            assignee: current.assignee,
            resolution: current.resolution,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt
          })
        }
        return current
      })
    route()
    const user = userEvent.setup()
    await fill('처리 확인')
    await user.selectOptions(
      screen.getByRole('combobox', { name: '처리 결과' }),
      outcome
    )
    submit().focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: '최종 처리 실행' })
      ).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: '문제 신고 상세' })
      ).toHaveFocus()
    )
    expect(endpoint).toHaveBeenCalledWith({
      operation: 'resolveAdminQuestionReport',
      params: { reportId: id },
      query: {},
      body: {
        expectedRowVersion: 2,
        outcome,
        reason: '처리 확인',
        remediationVersionId: null
      }
    })
  }
)

import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { questionReportDetailSchema } from '@nihongo/contracts/admin/phase7'
import { beforeEach, expect, it, vi } from 'vitest'
import { AdminReportDetailPage } from '@app/admin-report/detail/page'
import { queryClient } from '@libs/queryClient'
import { I18nProvider } from '@provider/I18nProvider'
const hooks = vi.hoisted(() => ({
  detail: vi.fn(),
  triage: vi.fn(),
  resolve: vi.fn(),
  fresh: vi.fn(),
  submit: vi.fn(),
  triageSubmit: vi.fn(),
  openFresh: vi.fn()
}))
vi.mock('@app/admin-report/hooks/useAdminReportQueries', () => ({
  useAdminReportDetail: hooks.detail
}))
vi.mock('@app/admin-report/hooks/useAdminReportCommands', () => ({
  useTriageAdminReport: hooks.triage,
  useResolveAdminReport: hooks.resolve
}))
vi.mock('@app/admin-question/hooks/useFreshAssurance', () => ({
  useFreshAssurance: hooks.fresh
}))
const id = '018f6b7a-1f4b-7d5e-8a91-4c27df9c7101'
const initial = questionReportDetailSchema.parse({
  id,
  questionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7102',
  questionVersionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7103',
  reason: 'OTHER',
  status: 'TRIAGED',
  rowVersion: 2,
  reporter: {
    kind: 'ACCOUNT',
    actorId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7104',
    role: 'USER',
    label: 'ACTIVE_USER'
  },
  assignee: {
    kind: 'ACCOUNT',
    actorId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7105',
    role: 'ADMIN',
    label: 'ACTIVE_ADMIN'
  },
  description: '<script>ordinary text</script>',
  descriptionDigest: '0'.repeat(64),
  resolution: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z'
})
const ready = {
  data: initial,
  isPending: false,
  isError: false,
  isFetching: false,
  fetchStatus: 'idle',
  error: null,
  refetch: vi.fn()
}
const renderDetail = (search = '') => {
  const router = createMemoryRouter(
    [
      { path: '/admin/reports/:reportId', element: <AdminReportDetailPage /> },
      { path: '/admin/reports', element: <p>returned list</p> }
    ],
    { initialEntries: [`/admin/reports/${id}${search}`] }
  )
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  )
  return router
}
beforeEach(() => {
  hooks.detail.mockReset()
  hooks.triage.mockReset()
  hooks.resolve.mockReset()
  hooks.fresh.mockReset()
  hooks.submit.mockReset()
  hooks.triageSubmit.mockReset()
  hooks.openFresh.mockReset()
  hooks.detail.mockReturnValue(ready)
  hooks.triage.mockReturnValue({
    error: null,
    isPending: false,
    mutate: hooks.triageSubmit,
    reset: vi.fn()
  })
  hooks.resolve.mockReturnValue({
    error: null,
    isPending: false,
    mutate: hooks.submit,
    reset: vi.fn()
  })
  hooks.fresh.mockReturnValue({
    isOpen: false,
    isPending: false,
    isRecovering: false,
    recoveryRequired: false,
    completionMessage: null,
    errorMessage: null,
    prompt: null,
    open: hooks.openFresh,
    close: vi.fn(),
    reauthenticate: vi.fn(),
    retryRecovery: vi.fn()
  })
})
it('renders escaped description and target IDs without a broken question-detail link', () => {
  renderDetail()
  expect(screen.getByText('<script>ordinary text</script>')).toBeInTheDocument()
  expect(document.querySelector('script')).not.toBeInTheDocument()
  expect(
    document.querySelector(`a[href="/admin/questions/${initial.questionId}"]`)
  ).not.toBeInTheDocument()
  expect(
    screen.getByText('대상 문제 상세 화면 연결은 준비 중입니다.')
  ).toBeInTheDocument()
})
it('returns to allowlisted list filters instead of an arbitrary return URL', () => {
  const returnTo = `/admin/reports?status=TRIAGED&page=3&focusReport=${id}`
  renderDetail(`?${new URLSearchParams({ returnTo })}`)
  const link = screen.getByRole('link', { name: '신고 목록으로' })
  const url = new URL(link.getAttribute('href') ?? '', 'https://example.test')
  expect(url.pathname).toBe('/admin/reports')
  expect(url.searchParams.get('status')).toBe('TRIAGED')
  expect(url.searchParams.get('page')).toBe('3')
})
it('focuses a required reason error; counts Unicode scalars and omits remediation when dismissed', async () => {
  const user = userEvent.setup()
  renderDetail()
  await user.click(screen.getByRole('button', { name: '최종 처리 실행' }))
  const reason = screen.getByRole('textbox', { name: '처리 사유' })
  expect(reason).toHaveFocus()
  expect(hooks.submit).not.toHaveBeenCalled()
  fireEvent.change(reason, { target: { value: '😀'.repeat(1000) } })
  await user.selectOptions(
    screen.getByRole('combobox', { name: '처리 결과' }),
    'DISMISSED'
  )
  expect(
    screen.queryByRole('textbox', { name: '개선 버전 ID' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '최종 처리 실행' }))
  expect(hooks.submit).toHaveBeenCalledWith({
    expectedRowVersion: 2,
    outcome: 'DISMISSED',
    reason: '😀'.repeat(1000),
    remediationVersionId: null
  })
})
it.each([{ isFetching: true }, { isError: true }, { isOffline: true }])(
  'locks processing while a cached read is unavailable: %o',
  (state) => {
    hooks.detail.mockReturnValue({ ...ready, ...state })
    renderDetail()
    expect(
      screen.getByRole('button', { name: '최종 처리 실행' })
    ).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '처리 사유' })).toBeDisabled()
  }
)
it.each(['RESOLVED', 'DISMISSED'] as const)(
  'shows terminal %s as read-only',
  (status) => {
    hooks.detail.mockReturnValue({
      ...ready,
      data: {
        ...initial,
        status,
        resolution: {
          outcome: status,
          reason: '처리 기록',
          remediationVersionId: null,
          resolvedAt: initial.updatedAt
        }
      }
    })
    renderDetail()
    expect(screen.getByText('처리 기록')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '최종 처리 실행' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '신고 분류 시작' })
    ).not.toBeInTheDocument()
  }
)
it('offers only triage for OPEN and sends the viewed row version', async () => {
  hooks.detail.mockReturnValue({
    ...ready,
    data: { ...initial, status: 'OPEN', assignee: null }
  })
  const user = userEvent.setup()
  renderDetail()
  expect(
    screen.queryByRole('button', { name: '최종 처리 실행' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '신고 분류 시작' }))
  expect(hooks.triageSubmit).toHaveBeenCalledWith({ expectedRowVersion: 2 })
})
it('keeps local input during conflict and uses the new version only after explicit successful refresh', async () => {
  const useConflictDetail = () => {
    const [data, setData] = useState(initial)
    return {
      ...ready,
      data,
      refetch: async () => {
        const next = { ...data, rowVersion: 3 }
        setData(next)
        return { isSuccess: true, data: next }
      }
    }
  }
  hooks.detail.mockImplementation(useConflictDetail)
  const useConflictResolution = () => {
    const [error, setError] = useState<Error | null>(null)
    return {
      isPending: false,
      error,
      reset: () => setError(null),
      mutate: (request: unknown) => {
        hooks.submit(request)
        setError(
          Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT' })
        )
      }
    }
  }
  hooks.resolve.mockImplementation(useConflictResolution)
  const user = userEvent.setup()
  renderDetail()
  await user.type(
    screen.getByRole('textbox', { name: '처리 사유' }),
    '로컬 입력 유지'
  )
  await user.click(screen.getByRole('button', { name: '최종 처리 실행' }))
  expect(screen.getByRole('button', { name: '최종 처리 실행' })).toBeDisabled()
  await user.click(
    screen.getByRole('button', { name: '최신 신고 상태 불러오기' })
  )
  expect(screen.getByRole('textbox', { name: '처리 사유' })).toHaveValue(
    '로컬 입력 유지'
  )
  await user.click(screen.getByRole('button', { name: '최종 처리 실행' }))
  expect(hooks.submit).toHaveBeenLastCalledWith({
    expectedRowVersion: 3,
    outcome: 'RESOLVED',
    reason: '로컬 입력 유지',
    remediationVersionId: null
  })
})
it('opens report step-up on fresh-assurance failure without replaying the resolution request', async () => {
  hooks.resolve.mockImplementation(
    (_reportId, _success, onError: (error: unknown) => void) => ({
      error: null,
      isPending: false,
      reset: vi.fn(),
      mutate: (request: unknown) => {
        hooks.submit(request)
        onError(
          Object.assign(new Error('reauth'), {
            code: 'FRESH_ASSURANCE_REQUIRED'
          })
        )
      }
    })
  )
  const user = userEvent.setup()
  renderDetail()
  await user.type(
    screen.getByRole('textbox', { name: '처리 사유' }),
    '재인증 후 직접 실행'
  )
  await user.click(screen.getByRole('button', { name: '최종 처리 실행' }))
  expect(hooks.openFresh).toHaveBeenCalledWith({
    questionIds: [initial.questionId],
    reportId: id,
    reasonCode: 'REPORT_RESOLUTION'
  })
  expect(hooks.submit).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('textbox', { name: '처리 사유' })).toHaveValue(
    '재인증 후 직접 실행'
  )
})
it('blocks dirty navigation, keeps edits on cancellation, and discards only on explicit leave', async () => {
  const user = userEvent.setup()
  const router = renderDetail()
  await user.type(
    screen.getByRole('textbox', { name: '처리 사유' }),
    '미저장 입력'
  )
  await user.click(screen.getByRole('link', { name: '신고 목록으로' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '계속 편집' }))
  expect(screen.getByRole('textbox', { name: '처리 사유' })).toHaveValue(
    '미저장 입력'
  )
  await user.click(screen.getByRole('link', { name: '신고 목록으로' }))
  await user.click(screen.getByRole('button', { name: '변경사항 버리고 이동' }))
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/admin/reports')
  )
})

it('rejects a processing reason exceeding the canonical 1000-scalar limit', async () => {
  const user = userEvent.setup()
  renderDetail()
  fireEvent.change(screen.getByRole('textbox', { name: '처리 사유' }), {
    target: { value: '😀'.repeat(1001) }
  })
  await user.click(screen.getByRole('button', { name: '최종 처리 실행' }))
  expect(hooks.submit).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: '처리 사유' })).toHaveFocus()
})

it.each(['loaded', 'not-found'] as const)(
  'D505-B2 detail marks the parent report area as current location, not current page: %s',
  (state) => {
    if (state === 'not-found')
      hooks.detail.mockReturnValue({
        ...ready,
        data: undefined,
        isError: true,
        error: new Error('not found')
      })
    renderDetail()
    const regionLink = screen.getByRole('link', {
      name: '신고 큐',
      current: 'location'
    })
    expect(regionLink).toHaveAttribute('href', '/admin/reports')
    expect(
      screen.queryByRole('link', { name: '신고 큐', current: 'page' })
    ).not.toBeInTheDocument()
  }
)

it.each(['OPEN', 'TRIAGED', 'RESOLVED', 'DISMISSED'] as const)(
  'D505-B2-04 keeps report information before the separate processing column: %s',
  (status) => {
    const terminal = status === 'RESOLVED' || status === 'DISMISSED'
    hooks.detail.mockReturnValue({
      ...ready,
      data: {
        ...initial,
        status,
        resolution: terminal
          ? {
              outcome: status,
              reason: '처리 기록',
              remediationVersionId: null,
              resolvedAt: initial.updatedAt
            }
          : null
      }
    })
    renderDetail()
    const metadata = screen.getByRole('region', { name: '신고 정보' })
    const content = metadata.closest<HTMLDivElement>(
      '.admin-report-detail-content'
    )
    const grid = content?.parentElement
    expect(content).not.toBeNull()
    expect(grid).toHaveClass('admin-report-detail-grid')
    if (!content || !grid)
      throw new Error('Report detail content column missing')
    const processing = grid.querySelector<HTMLDivElement>(
      '.admin-report-detail-processing'
    )
    if (!processing) throw new Error('Report detail processing column missing')
    expect(Array.from(grid.children)).toEqual([content, processing])
    expect(within(content).getByText(initial.questionId)).toBeInTheDocument()
    expect(
      within(content).getByText('<script>ordinary text</script>')
    ).toBeInTheDocument()
    expect(within(content).queryByRole('button')).not.toBeInTheDocument()
    if (status === 'OPEN') {
      expect(
        within(processing).getByRole('button', { name: '신고 분류 시작' })
      ).toBeEnabled()
    } else if (status === 'TRIAGED') {
      expect(
        within(processing).getByRole('textbox', { name: '처리 사유' })
      ).toBeInTheDocument()
      expect(
        within(processing).getByRole('button', { name: '최종 처리 실행' })
      ).toBeEnabled()
    } else {
      expect(within(processing).getByText('처리 기록')).toBeInTheDocument()
      expect(within(processing).queryByRole('button')).not.toBeInTheDocument()
    }
  }
)

it('D505-B2-04 keeps conflict recovery before the locked form in the processing column', () => {
  hooks.resolve.mockReturnValue({
    error: Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT' }),
    isPending: false,
    mutate: hooks.submit,
    reset: vi.fn()
  })
  renderDetail()
  const reason = screen.getByRole('textbox', { name: '처리 사유' })
  const processing = reason.closest<HTMLDivElement>(
    '.admin-report-detail-processing'
  )
  if (!processing) throw new Error('Report detail processing column missing')
  const retry = within(processing).getByRole('button', {
    name: '최신 신고 상태 불러오기'
  })
  expect(reason).toBeDisabled()
  expect(
    within(processing).getByRole('button', { name: '최종 처리 실행' })
  ).toBeDisabled()
  expect(
    retry.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
})

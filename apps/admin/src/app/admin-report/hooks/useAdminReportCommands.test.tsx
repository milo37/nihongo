import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { questionReportMutationResultSchema } from '@nihongo/contracts/admin/phase7'
import {
  advanceAuthTransitionEpoch,
  AuthTransitionSupersededError
} from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import * as api from '@nihongo/browser/api/phase7/requestPhase7Operation'
import {
  useTriageAdminReport,
  useResolveAdminReport
} from '@app/admin-report/hooks/useAdminReportCommands'
import { adminReportQueries } from '@app/admin-report/queries/adminReportQueries'
import { adminAuditQueries } from '@app/admin-audit/queries/adminAuditQueries'
import { adminQuestionQueries } from '@app/admin-question/queries/adminQuestionQueries'
const actorId = '10000000-0000-4000-8000-000000000001'
const reportId = '10000000-0000-4000-8000-000000000002'
const resultData = questionReportMutationResultSchema.parse({
  id: reportId,
  questionId: actorId,
  questionVersionId: actorId,
  status: 'TRIAGED',
  rowVersion: 2,
  assignee: { kind: 'ACCOUNT', actorId, role: 'ADMIN', label: 'ACTIVE_ADMIN' },
  resolution: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z'
})
const resolvedResult = questionReportMutationResultSchema.parse({
  ...resultData,
  status: 'DISMISSED',
  rowVersion: 3,
  resolution: {
    outcome: 'DISMISSED',
    reason: '확인',
    remediationVersionId: null,
    resolvedAt: resultData.updatedAt
  }
})

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  onlineManager.setOnline(true)
  useAppStore.getState().setCurrentUser({
    id: actorId,
    name: '관리자',
    role: 'ADMIN',
    targetLevel: 'N3'
  })
})
afterEach(() => {
  cleanup()
  client.clear()
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
})
it('sends the exact viewed rowVersion and invalidates reports/detail plus audit only after triage commit', async () => {
  const endpoint = vi
    .spyOn(api, 'requestPhase7Operation')
    .mockResolvedValue(resultData)
  const invalidation = vi.spyOn(client, 'invalidateQueries')
  const success = vi.fn()
  const { result } = renderHook(() => useTriageAdminReport(reportId, success), {
    wrapper
  })
  await act(async () => {
    await result.current.mutateAsync({ expectedRowVersion: 1 })
  })
  expect(endpoint).toHaveBeenCalledWith({
    operation: 'triageAdminQuestionReport',
    params: { reportId },
    query: {},
    body: { expectedRowVersion: 1 }
  })
  expect(invalidation.mock.calls.map(([x]) => x?.queryKey)).toEqual([
    adminReportQueries.allKey(),
    adminAuditQueries.allKey()
  ])
  expect(success).toHaveBeenCalledWith('TRIAGED')
})
it('awaits all resolution publication invalidations before success', async () => {
  vi.spyOn(api, 'requestPhase7Operation').mockResolvedValue(resolvedResult)
  let finish!: () => void
  const barrier = new Promise<void>((resolve) => {
    finish = resolve
  })
  const invalidation = vi
    .spyOn(client, 'invalidateQueries')
    .mockReturnValue(barrier)
  const success = vi.fn()
  const { result } = renderHook(
    () => useResolveAdminReport(reportId, success),
    { wrapper }
  )
  let pending!: Promise<unknown>
  await act(async () => {
    pending = result.current.mutateAsync({
      expectedRowVersion: 2,
      outcome: 'DISMISSED',
      reason: '확인',
      remediationVersionId: null
    })
  })
  await waitFor(() => expect(invalidation).toHaveBeenCalledTimes(6))
  expect(success).not.toHaveBeenCalled()
  expect(result.current.isPending).toBe(true)
  expect(invalidation.mock.calls.map(([x]) => x?.queryKey)).toContainEqual(
    adminQuestionQueries.allKey()
  )
  await act(async () => {
    finish()
    await pending
  })
  expect(success).toHaveBeenCalledWith('DISMISSED')
})
it.each(['GUEST', 'USER', 'OFFLINE'])(
  'refuses %s commands before the endpoint',
  async (kind) => {
    const endpoint = vi.spyOn(api, 'requestPhase7Operation')
    if (kind === 'GUEST') useAppStore.getState().setCurrentUser(null)
    if (kind === 'USER')
      useAppStore.getState().setCurrentUser({
        id: actorId,
        name: '회원',
        role: 'USER',
        targetLevel: null
      })
    if (kind === 'OFFLINE') onlineManager.setOnline(false)
    const { result } = renderHook(() => useTriageAdminReport(reportId), {
      wrapper
    })
    await act(async () => {
      await expect(
        result.current.mutateAsync({ expectedRowVersion: 1 })
      ).rejects.toBeInstanceOf(Error)
    })
    expect(endpoint).not.toHaveBeenCalled()
  }
)
it('rejects late same-ID logout/login settlement with no invalidation or callback', async () => {
  let finish!: (value: typeof resultData) => void
  vi.spyOn(api, 'requestPhase7Operation').mockImplementation(
    () =>
      new Promise<typeof resultData>((resolve) => {
        finish = resolve
      })
  )
  const invalidation = vi.spyOn(client, 'invalidateQueries')
  const success = vi.fn()
  const failure = vi.fn()
  const { result } = renderHook(
    () => useResolveAdminReport(reportId, success, failure),
    { wrapper }
  )
  let pending!: Promise<unknown>
  await act(async () => {
    pending = result.current
      .mutateAsync({
        expectedRowVersion: 2,
        outcome: 'DISMISSED',
        reason: '확인',
        remediationVersionId: null
      })
      .catch((error: unknown) => error)
  })
  advanceAuthTransitionEpoch()
  await act(async () => {
    finish(resolvedResult)
    expect(await pending).toBeInstanceOf(AuthTransitionSupersededError)
  })
  expect(invalidation).not.toHaveBeenCalled()
  expect(success).not.toHaveBeenCalled()
  expect(failure).not.toHaveBeenCalled()
})
it('keeps a queued command bound to its original actor before endpoint dispatch', async () => {
  let finish!: (value: typeof resultData) => void
  const endpoint = vi.spyOn(api, 'requestPhase7Operation').mockImplementation(
    () =>
      new Promise<typeof resultData>((resolve) => {
        finish = resolve
      })
  )
  const { result } = renderHook(
    () => ({
      first: useTriageAdminReport(reportId),
      second: useTriageAdminReport(reportId)
    }),
    { wrapper }
  )
  let first!: Promise<unknown>
  let second!: Promise<unknown>
  await act(async () => {
    first = result.current.first
      .mutateAsync({ expectedRowVersion: 1 })
      .catch((error: unknown) => error)
    second = result.current.second
      .mutateAsync({ expectedRowVersion: 1 })
      .catch((error: unknown) => error)
  })
  await waitFor(() => expect(result.current.second.isPaused).toBe(true))
  advanceAuthTransitionEpoch()
  await act(async () => {
    finish(resultData)
    expect(await first).toBeInstanceOf(AuthTransitionSupersededError)
    expect(await second).toBeInstanceOf(AuthTransitionSupersededError)
  })
  expect(endpoint).toHaveBeenCalledTimes(1)
})
it('does not invalidate or invoke success after a definitive 409 failure', async () => {
  vi.spyOn(api, 'requestPhase7Operation').mockRejectedValue({
    code: 'VERSION_CONFLICT'
  })
  const invalidation = vi.spyOn(client, 'invalidateQueries')
  const success = vi.fn()
  const failure = vi.fn()
  const { result } = renderHook(
    () => useResolveAdminReport(reportId, success, failure),
    { wrapper }
  )
  await act(async () => {
    await expect(
      result.current.mutateAsync({
        expectedRowVersion: 2,
        outcome: 'DISMISSED',
        reason: '확인',
        remediationVersionId: null
      })
    ).rejects.toEqual({ code: 'VERSION_CONFLICT' })
  })
  expect(invalidation).not.toHaveBeenCalled()
  expect(success).not.toHaveBeenCalled()
  expect(failure).toHaveBeenCalledOnce()
})

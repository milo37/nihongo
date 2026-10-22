import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { questionReportMutationResultSchema } from '@nihongo/contracts/admin/phase7'
import {
  useResolveAdminReport,
  useTriageAdminReport
} from '@app/admin-report/hooks/useAdminReportCommands'
import {
  adminQuestionKeys,
  adminQuestionReportKeys,
  adminAuditLogKeys
} from '@app/admin-question/queries/phase7AdminQueries'
import {
  advanceAuthTransitionEpoch,
  AuthTransitionSupersededError
} from '@libs/authTransitionFence'
import { queryClient } from '@libs/queryClient'
import { useAppStore } from '@store/index'
const api = vi.hoisted(() => ({ triage: vi.fn(), resolve: vi.fn() }))
vi.mock('@api/phase7/phase7AdminApi', async (original) => ({
  ...(await original<typeof import('@api/phase7/phase7AdminApi')>()),
  triagePhase7AdminQuestionReport: api.triage,
  resolvePhase7AdminQuestionReport: api.resolve
}))
const actorId = '018f6b7a-1f4b-7d5e-8a91-4c27df9c7105'
const reportId = '018f6b7a-1f4b-7d5e-8a91-4c27df9c7101'
const questionId = '018f6b7a-1f4b-7d5e-8a91-4c27df9c7102'
const resultData = questionReportMutationResultSchema.parse({
  id: reportId,
  questionId,
  questionVersionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7103',
  status: 'TRIAGED',
  rowVersion: 2,
  assignee: { kind: 'ACCOUNT', actorId, role: 'ADMIN', label: 'ACTIVE_ADMIN' },
  resolution: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z'
})
const wrapper = ({ children }: { readonly children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)
beforeEach(() => {
  api.triage.mockReset()
  api.resolve.mockReset()
  useAppStore.getState().setCurrentUser({
    id: actorId,
    name: '관리자',
    role: 'ADMIN',
    targetLevel: 'N5'
  })
})
it('sends current rowVersion and invalidates report list/detail/audit without question caches for triage', async () => {
  api.triage.mockResolvedValue(resultData)
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const success = vi.fn()
  const { result } = renderHook(() => useTriageAdminReport(reportId, success), {
    wrapper
  })
  await act(async () => {
    await result.current.mutateAsync({ expectedRowVersion: 1 })
  })
  expect(api.triage).toHaveBeenCalledWith(reportId, { expectedRowVersion: 1 })
  const keys = invalidate.mock.calls.map(([input]) => input?.queryKey)
  expect(keys).toEqual(
    expect.arrayContaining([
      adminQuestionReportKeys.allLists(),
      adminQuestionReportKeys.detail(reportId),
      adminAuditLogKeys.allLists()
    ])
  )
  expect(keys).not.toContainEqual(adminQuestionKeys.allLists())
  expect(success).toHaveBeenCalledWith('TRIAGED')
})
it('invalidates the resolved question as well as report and audit families', async () => {
  api.resolve.mockResolvedValue({ ...resultData, status: 'RESOLVED' })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const { result } = renderHook(() => useResolveAdminReport(reportId), {
    wrapper
  })
  const request = {
    expectedRowVersion: 2,
    outcome: 'RESOLVED' as const,
    reason: '해설 확인',
    remediationVersionId: null
  }
  await act(async () => {
    await result.current.mutateAsync(request)
  })
  expect(api.resolve).toHaveBeenCalledWith(reportId, request)
  expect(invalidate.mock.calls.map(([input]) => input?.queryKey)).toEqual(
    expect.arrayContaining([
      adminQuestionKeys.allLists(),
      adminQuestionKeys.detail(questionId),
      adminQuestionReportKeys.allLists(),
      adminQuestionReportKeys.detail(reportId)
    ])
  )
})
it('rejects commands from non-admin actors before an endpoint call', async () => {
  useAppStore.getState().setCurrentUser(null)
  const { result } = renderHook(() => useTriageAdminReport(reportId), {
    wrapper
  })
  await act(async () => {
    await expect(
      result.current.mutateAsync({ expectedRowVersion: 1 })
    ).rejects.toBeInstanceOf(AuthTransitionSupersededError)
  })
  expect(api.triage).not.toHaveBeenCalled()
})
it('ignores a late successful command after logout/login even with the same actor ID', async () => {
  let finish: ((value: typeof resultData) => void) | undefined
  api.resolve.mockImplementation(
    () =>
      new Promise<typeof resultData>((resolve) => {
        finish = resolve
      })
  )
  const success = vi.fn()
  const error = vi.fn()
  const { result } = renderHook(
    () => useResolveAdminReport(reportId, success, error),
    { wrapper }
  )
  let pending: Promise<unknown> | undefined
  await act(async () => {
    pending = result.current
      .mutateAsync({
        expectedRowVersion: 2,
        outcome: 'DISMISSED',
        reason: '중복 신고',
        remediationVersionId: null
      })
      .catch((cause: unknown) => cause)
  })
  advanceAuthTransitionEpoch()
  await act(async () => {
    finish?.(resultData)
    await pending
  })
  expect(success).not.toHaveBeenCalled()
  expect(error).not.toHaveBeenCalled()
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createQuestionReportResponseSchema } from '@nihongo/contracts/admin/phase7'
import { useCreatePhase7QuestionReport } from '@app/question-report/hooks/useCreatePhase7QuestionReport'
import { AuthTransitionSupersededError } from '@libs/authTransitionFence'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'

const { createQuestionReport } = vi.hoisted(() => ({
  createQuestionReport: vi.fn()
}))

vi.mock('@api/phase7/phase7AdminApi', () => ({
  createPhase7QuestionReport: createQuestionReport
}))

const reportResult = createQuestionReportResponseSchema.parse({
  id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7001',
  questionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7002',
  questionVersionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7003',
  status: 'OPEN',
  rowVersion: 1,
  assignee: null,
  resolution: null,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z'
})

describe('question report mutation settlement fence', () => {
  it('suppresses the success callback after a same-epoch actor change', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } }
    })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const user = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(user)
    createQuestionReport.mockResolvedValueOnce(reportResult)
    let releaseInvalidation: (() => void) | undefined
    const invalidationGate = new Promise<void>((resolve) => {
      releaseInvalidation = resolve
    })
    const invalidationStarted = vi.fn()
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(async () => {
      invalidationStarted()
      await invalidationGate
    })
    const callback = vi.fn()
    const { result } = renderHook(
      () => useCreatePhase7QuestionReport(callback),
      { wrapper }
    )

    let reportPromise!: Promise<unknown>
    act(() => {
      reportPromise = result.current.mutateAsync({
        questionId: reportResult.questionId,
        request: {
          questionVersionId: reportResult.questionVersionId,
          reason: 'OTHER',
          description: '같은 epoch actor 전환 중인 신고 설명입니다.'
        }
      })
    })
    await waitFor(() => expect(invalidationStarted).toHaveBeenCalled())

    useAppStore.getState().setCurrentUser(mockDatabase.loginAs('ADMIN'))
    releaseInvalidation?.()

    await expect(reportPromise).rejects.toBeInstanceOf(
      AuthTransitionSupersededError
    )
    expect(callback).not.toHaveBeenCalled()
  })
})

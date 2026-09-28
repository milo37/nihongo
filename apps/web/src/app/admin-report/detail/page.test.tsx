import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { getAdminQuestionReportResponseSchema } from '@nihongo/contracts/admin/phase7'
import { describe, expect, it, vi } from 'vitest'
import { AdminQuestionReportDetailPage } from '@app/admin-report/detail/page'

const hookMocks = vi.hoisted(() => ({
  reportDetail: vi.fn(),
  resolveReport: vi.fn(),
  triageReport: vi.fn()
}))

vi.mock(
  '@app/admin-question/hooks/usePhase7AdminQueries',
  async (importOriginal) => ({
    ...(await importOriginal()),
    usePhase7AdminQuestionReportDetail: hookMocks.reportDetail
  })
)

vi.mock(
  '@app/admin-question/hooks/usePhase7AdminMutations',
  async (importOriginal) => ({
    ...(await importOriginal()),
    useResolvePhase7AdminQuestionReport: hookMocks.resolveReport,
    useTriagePhase7AdminQuestionReport: hookMocks.triageReport
  })
)

const initialReport = getAdminQuestionReportResponseSchema.parse({
  id: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7101',
  questionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7102',
  questionVersionId: '018f6b7a-1f4b-7d5e-8a91-4c27df9c7103',
  reason: 'OTHER',
  status: 'TRIAGED',
  rowVersion: 1,
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
  description: '신고 충돌 복구 테스트입니다.',
  descriptionDigest: '0'.repeat(64),
  resolution: null,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:01:00.000Z'
})

describe('AdminQuestionReportDetailPage conflict recovery', () => {
  it('retains resolution input and clears a conflict only after detail refetch succeeds', async () => {
    hookMocks.reportDetail.mockImplementation(() => {
      const [data, setData] = useState(initialReport)
      return {
        data,
        error: null,
        isError: false,
        isPending: false,
        refetch: async () => {
          const next = { ...data, rowVersion: 2 }
          setData(next)
          return { data: next, isSuccess: true }
        }
      }
    })
    hookMocks.triageReport.mockReturnValue({
      error: null,
      isPending: false,
      mutate: vi.fn(),
      reset: vi.fn()
    })
    hookMocks.resolveReport.mockImplementation(
      (
        _reportId,
        _onSuccess,
        onError: ((error: unknown) => void) | undefined
      ) => {
        const [error, setError] = useState<Error | null>(null)
        return {
          error,
          isPending: false,
          mutate: () => {
            const conflict = Object.assign(new Error('충돌'), {
              code: 'VERSION_CONFLICT',
              serverMessage: '다른 작업에서 신고 상태가 변경됐습니다.',
              status: 409
            })
            setError(conflict)
            onError?.(conflict)
          },
          reset: () => setError(null)
        }
      }
    )
    const client = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false }
      }
    })
    const router = createMemoryRouter(
      [
        {
          path: '/admin/reports/:reportId',
          element: <AdminQuestionReportDetailPage />
        }
      ],
      { initialEntries: [`/admin/reports/${initialReport.id}`] }
    )
    const interaction = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    const reason = await screen.findByLabelText('처리 사유')
    await interaction.type(reason, '입력한 처리 사유는 유지되어야 합니다.')
    await interaction.click(
      screen.getByRole('button', { name: '최종 처리 실행' })
    )
    expect(
      await screen.findByRole('heading', {
        name: '다른 작업에서 신고 상태가 변경됐습니다'
      })
    ).toBeVisible()
    expect(reason).toHaveValue('입력한 처리 사유는 유지되어야 합니다.')

    await interaction.click(
      screen.getByRole('button', { name: '최신 신고 상태 불러오기' })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', {
          name: '다른 작업에서 신고 상태가 변경됐습니다'
        })
      ).not.toBeInTheDocument()
    )
    expect(reason).toHaveValue('입력한 처리 사유는 유지되어야 합니다.')
  })
})

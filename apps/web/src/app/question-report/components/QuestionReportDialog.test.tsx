import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { buildPhase7OperationFailureResponse } from '@nihongo/contracts/admin/phase7'
import { describe, expect, it } from 'vitest'
import { QuestionReportDialog } from '@app/question-report/components/QuestionReportDialog'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const renderDialog = (): ReturnType<typeof render> => {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(
    <QuestionReportDialog
      questionId="018f6b7a-1f4b-7d5e-8a91-4c27df9c7002"
      questionVersionId="018f6b7a-1f4b-7d5e-8a91-4c27df9c7003"
    />,
    { wrapper }
  )
}

describe('QuestionReportDialog', () => {
  it('keeps the draft and focuses submit after a non-field duplicate failure', async () => {
    const user = mockDatabase.loginAs('USER')
    useAppStore.getState().setCurrentUser(user)
    mockServer.use(
      http.post('*/api/v1/question-reports', () => {
        const requestId = crypto.randomUUID()
        const response = buildPhase7OperationFailureResponse({
          operation: 'createQuestionReport',
          disposition: 'DEFINITE_ROLLBACK',
          failure: {
            code: 'QUESTION_REPORT_DUPLICATE',
            message: '처리 중인 신고가 이미 있습니다.',
            requestId
          }
        })
        return HttpResponse.json(response.body, {
          status: response.status,
          headers: response.headers
        })
      })
    )
    const interaction = userEvent.setup()
    renderDialog()

    await interaction.click(screen.getByRole('button', { name: '문제 신고' }))
    const description = screen.getByLabelText('설명')
    await interaction.type(description, '중복 신고 포커스 복구 테스트')
    const submit = screen.getByRole('button', {
      name: '신고 접수'
    })
    await interaction.click(submit)

    expect(
      await screen.findByText(
        '같은 문제 버전에 처리 중인 신고가 이미 있습니다.'
      )
    ).toBeVisible()
    expect(description).toHaveValue('중복 신고 포커스 복구 테스트')
    expect(submit).toHaveFocus()
  })
})

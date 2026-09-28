import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import {
  buildPhase7OperationFailureResponse,
  createAdminQuestionRequestSchema
} from '@nihongo/contracts/admin/phase7'
import { describe, expect, it } from 'vitest'
import { AdminQuestionDetailPage } from '@app/admin-question/detail/page'
import { DEMO_ADMIN_ID, DEMO_REVIEWER_ADMIN_ID } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const createReviewTarget = async (): Promise<{
  readonly questionId: string
  readonly versionId: string
}> => {
  mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
  const state = mockDatabase.getPhase7AdminCmsStateForHandlers()
  const sources = mockDatabase.listCanonicalAdminQuestionSources()
  const created = await state.createQuestion({
    actorId: DEMO_ADMIN_ID,
    assertAuthority: () => undefined,
    request: createAdminQuestionRequestSchema.parse({
      level: 'N5',
      subject: 'GRAMMAR',
      questionType: 'GRAMMAR_SELECT',
      difficulty: 'EASY',
      questionText: '明日は 学校へ 行く（　）です。',
      passage: null,
      explanationKo: '서버 필드 오류 포커스 회귀 테스트입니다.',
      explanationJa: null,
      tagNames: ['조사'],
      options: [
        { clientOptionKey: 'option-1', text: '予定' },
        { clientOptionKey: 'option-2', text: '理由' },
        { clientOptionKey: 'option-3', text: '場所' },
        { clientOptionKey: 'option-4', text: '時間' }
      ],
      correctOptionKey: 'option-1'
    }),
    requestId: crypto.randomUUID(),
    sources
  })
  if (!created.questionVersionId) throw new Error('Version ID is missing.')
  await state.transitionVersion({
    actorId: DEMO_ADMIN_ID,
    assertAuthority: () => undefined,
    operation: 'requestContentReview',
    request: { expectedRowVersion: 1 },
    requestId: crypto.randomUUID(),
    sources,
    versionId: created.questionVersionId
  })
  return {
    questionId: created.questionId,
    versionId: created.questionVersionId
  }
}

describe('AdminQuestionDetailPage command validation', () => {
  it('keeps the command dialog open, retains the note, and focuses the first server field error', async () => {
    const target = await createReviewTarget()
    const reviewer = mockDatabase.loginAs('ADMIN', DEMO_REVIEWER_ADMIN_ID)
    useAppStore.getState().setCurrentUser(reviewer)
    mockServer.use(
      http.post(
        `*/api/v1/admin/question-versions/${target.versionId}/change-request`,
        () => {
          const requestId = crypto.randomUUID()
          const response = buildPhase7OperationFailureResponse({
            operation: 'requestQuestionChanges',
            disposition: 'DEFINITE_ROLLBACK',
            failure: {
              code: 'VALIDATION_ERROR',
              message: '수정 요청 사유를 확인해 주세요.',
              requestId,
              fieldErrors: { reason: ['구체적인 수정 사유가 필요합니다.'] }
            }
          })
          return HttpResponse.json(response.body, {
            status: response.status,
            headers: response.headers
          })
        }
      )
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
          path: '/admin/questions/:questionId',
          element: <AdminQuestionDetailPage />
        }
      ],
      { initialEntries: [`/admin/questions/${target.questionId}`] }
    )
    const interaction = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    await interaction.click(
      await screen.findByRole('button', {
        name: '수정 요청'
      })
    )
    const reason = screen.getByLabelText('사유 (필수)')
    const confirm = screen.getByRole('button', { name: '명시적으로 실행' })
    await interaction.type(reason, '가'.repeat(101))
    expect(
      screen.getByText('메모는 100자 이하여야 합니다.', { exact: true })
    ).toBeVisible()
    expect(confirm).toBeDisabled()
    await interaction.clear(reason)
    await interaction.type(reason, '로컬 입력을 유지해야 합니다.')
    expect(confirm).toBeEnabled()
    await interaction.click(confirm)

    expect(
      await screen.findByRole('heading', {
        name: '수정 요청 확인'
      })
    ).toBeVisible()
    expect(reason).toHaveValue('로컬 입력을 유지해야 합니다.')
    expect(
      screen.getByText('구체적인 수정 사유가 필요합니다.', { exact: true })
    ).toBeVisible()
    expect(reason).toHaveFocus()
  })
})

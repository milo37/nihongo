import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import {
  buildPhase7OperationFailureResponse,
  createAdminQuestionRequestSchema
} from '@nihongo/contracts/admin/phase7'
import { describe, expect, it } from 'vitest'
import { AdminQuestionPage } from '@app/admin-question/page'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
import { toCanonicalAdminQuestionList } from '@mocks/adapters/adminCmsReadContractAdapter'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

describe('AdminQuestionPage batch conflict', () => {
  it('retains selection and clears the conflict only after a successful canonical list refresh', async () => {
    const admin = mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    useAppStore.getState().setCurrentUser(admin)
    const questionText = '毎朝 日本語を 練習する（　）に しています。'
    await mockDatabase.getPhase7AdminCmsStateForHandlers().createQuestion({
      actorId: DEMO_ADMIN_ID,
      assertAuthority: () => undefined,
      request: createAdminQuestionRequestSchema.parse({
        level: 'N5',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        difficulty: 'EASY',
        questionText,
        passage: null,
        explanationKo: '일괄 충돌 선택 유지 회귀 테스트입니다.',
        explanationJa: null,
        tagNames: ['조사'],
        options: [
          { clientOptionKey: 'option-1', text: 'こと' },
          { clientOptionKey: 'option-2', text: 'もの' },
          { clientOptionKey: 'option-3', text: 'ところ' },
          { clientOptionKey: 'option-4', text: 'はず' }
        ],
        correctOptionKey: 'option-1'
      }),
      requestId: crypto.randomUUID(),
      sources: mockDatabase.listCanonicalAdminQuestionSources()
    })
    const listResponse = toCanonicalAdminQuestionList(
      {
        snapshot: mockDatabase.getCanonicalAdminCmsSnapshot(),
        sources: mockDatabase.listCanonicalAdminQuestionSources()
      },
      {
        authorActorId: DEMO_ADMIN_ID,
        page: 1,
        pageSize: 20,
        sort: 'UPDATED_DESC'
      }
    )
    expect(
      listResponse.items.map((item) => item.questionTextPreview)
    ).toContain(questionText)
    mockServer.use(
      http.get('*/api/v1/admin/questions', () =>
        HttpResponse.json(listResponse, {
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Request-Id': crypto.randomUUID()
          }
        })
      ),
      http.post('*/api/v1/admin/question-versions/review-request-batch', () => {
        const requestId = crypto.randomUUID()
        const response = buildPhase7OperationFailureResponse({
          operation: 'requestContentReviewBatch',
          disposition: 'DEFINITE_ROLLBACK',
          failure: {
            code: 'VERSION_CONFLICT',
            message: '다른 요청이 먼저 문제 버전을 변경했습니다.',
            requestId
          }
        })
        return HttpResponse.json(response.body, {
          status: response.status,
          headers: response.headers
        })
      })
    )
    const client = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false }
      }
    })
    const router = createMemoryRouter(
      [{ path: '/admin/questions', element: <AdminQuestionPage /> }],
      {
        initialEntries: [`/admin/questions?authorActorId=${DEMO_ADMIN_ID}`]
      }
    )
    const interaction = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    const checkbox = within(await screen.findByRole('table')).getByRole(
      'checkbox'
    )
    await interaction.click(checkbox)
    await interaction.click(
      screen.getByRole('button', { name: '선택 항목 검수 요청' })
    )
    expect(
      await screen.findByRole('heading', {
        name: '다른 작업에서 문제 버전이 변경됐습니다'
      })
    ).toBeVisible()
    expect(checkbox).toBeChecked()

    await interaction.click(
      screen.getByRole('button', { name: '최신 문제 목록 불러오기' })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', {
          name: '다른 작업에서 문제 버전이 변경됐습니다'
        })
      ).not.toBeInTheDocument()
    )
    expect(checkbox).toBeChecked()
    expect(screen.getByText(/^1개 선택됨/u)).toBeVisible()
  })
})

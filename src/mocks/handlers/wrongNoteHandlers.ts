import type { User } from '@common/types/domain'
import { http, HttpResponse } from 'msw'
import { listWrongNoteRequestSchema } from '@api/wrong-note/listWrongNote/schema'
import { reviewWrongNoteRequestSchema } from '@api/wrong-note/reviewWrongNote/schema'
import { updateWrongNoteMemoRequestSchema } from '@api/wrong-note/updateWrongNoteMemo/schema'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import {
  MockHttpError,
  parseJsonBody,
  parseSearchParams,
  toErrorResponse
} from '@mocks/handlers/shared'

const requireAuthenticatedUser = (): User => {
  const user = mockDatabase.getCurrentUser()

  if (!user) {
    throw new MockHttpError(
      401,
      'AUTHENTICATION_REQUIRED',
      '로그인이 필요한 기능입니다.'
    )
  }

  return user
}

export const wrongNoteHandlers = [
  http.get('*/api/wrong-note', ({ request }) => {
    try {
      const user = requireAuthenticatedUser()
      const params = parseSearchParams(request, listWrongNoteRequestSchema)
      return HttpResponse.json(mockDatabase.listWrongNotes(user.id, params))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.get('*/api/wrong-note/:questionId', ({ params }) => {
    try {
      const user = requireAuthenticatedUser()
      const questionId = String(params.questionId ?? '')

      return HttpResponse.json(mockDatabase.getWrongNote(user.id, questionId))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.put('*/api/wrong-note/:questionId/memo', async ({ params, request }) => {
    try {
      const user = requireAuthenticatedUser()
      const questionId = String(params.questionId ?? '')
      const input = await parseJsonBody(
        request,
        updateWrongNoteMemoRequestSchema
      )
      return HttpResponse.json(
        mockDatabase.updateWrongNoteMemo(user.id, questionId, input.memo)
      )
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.post(
    '*/api/wrong-note/:questionId/review',
    async ({ params, request }) => {
      try {
        const user = requireAuthenticatedUser()
        const questionId = String(params.questionId ?? '')
        const input = await parseJsonBody(request, reviewWrongNoteRequestSchema)
        return HttpResponse.json(
          mockDatabase.reviewWrongNote(user.id, questionId, input.isCorrect)
        )
      } catch (error: unknown) {
        return toErrorResponse(error)
      }
    }
  )
]

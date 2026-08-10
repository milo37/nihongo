import { http, HttpResponse } from 'msw'
import { createStudySessionRequestSchema } from '@api/study/createStudySession/schema'
import { submitStudySessionRequestSchema } from '@api/study/submitStudySession/schema'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { parseJsonBody, toErrorResponse } from '@mocks/handlers/shared'

export const studyHandlers = [
  http.post('*/api/study/session', async ({ request }) => {
    try {
      const input = await parseJsonBody(
        request,
        createStudySessionRequestSchema
      )
      return HttpResponse.json(mockDatabase.createStudySession(input))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.get('*/api/study/session/:sessionId', ({ params }) => {
    try {
      const sessionId = String(params.sessionId ?? '')
      return HttpResponse.json(mockDatabase.getStudySessionPayload(sessionId))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  }),
  http.post(
    '*/api/study/session/:sessionId/submit',
    async ({ params, request }) => {
      try {
        const sessionId = String(params.sessionId ?? '')
        const input = await parseJsonBody(
          request,
          submitStudySessionRequestSchema
        )
        const result = mockDatabase.submitStudySession({
          sessionId,
          answers: input.answers,
          durationSec: input.durationSec
        })

        return HttpResponse.json(result)
      } catch (error: unknown) {
        return toErrorResponse(error)
      }
    }
  ),
  http.get('*/api/study/session/:sessionId/result', ({ params }) => {
    try {
      const sessionId = String(params.sessionId ?? '')
      return HttpResponse.json(mockDatabase.getStudyResult(sessionId))
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })
]

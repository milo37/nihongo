import { safePost } from '@api/http'
import {
  submitStudySessionParamsSchema,
  submitStudySessionRequestSchema,
  submitStudySessionResponseSchema
} from '@api/study/submitStudySession/schema'
import type {
  SubmitStudySessionRequest,
  SubmitStudySessionResponse
} from '@api/study/submitStudySession/schema'

const requestSessionSubmission = safePost(submitStudySessionResponseSchema)

export const submitStudySession = (
  sessionId: string,
  input: SubmitStudySessionRequest
): Promise<SubmitStudySessionResponse> => {
  const params = submitStudySessionParamsSchema.parse({ sessionId })
  const request = submitStudySessionRequestSchema.parse(input)

  return requestSessionSubmission(
    `/study/session/${params.sessionId}/submit`,
    request
  )
}

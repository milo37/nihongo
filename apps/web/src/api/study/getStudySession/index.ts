import { safeGet } from '@api/http'
import {
  getStudySessionRequestSchema,
  getStudySessionResponseSchema
} from '@api/study/getStudySession/schema'
import type { GetStudySessionResponse } from '@api/study/getStudySession/schema'

const requestStudySession = safeGet(getStudySessionResponseSchema)

export const getStudySession = (
  sessionId: string
): Promise<GetStudySessionResponse> => {
  const request = getStudySessionRequestSchema.parse({ sessionId })

  return requestStudySession(`/study/session/${request.sessionId}`)
}

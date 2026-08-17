import { safeGet } from '@api/http'
import {
  getStudySessionV1RequestSchema,
  getStudySessionV1ResponseSchema
} from '@api/study/getStudySessionV1/schema'
import type { GetStudySessionV1Response } from '@api/study/getStudySessionV1/schema'

const requestStudySession = safeGet(getStudySessionV1ResponseSchema)

export const getStudySessionV1 = (
  sessionId: string
): Promise<GetStudySessionV1Response> => {
  const request = getStudySessionV1RequestSchema.parse({ sessionId })

  return requestStudySession(`/v1/study-sessions/${request.sessionId}`)
}
